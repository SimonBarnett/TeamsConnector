import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

export class EnvelopeCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("ARTIFACT_ENCRYPTION_KEY must decode to 32 bytes");
    }
  }

  static fromEnv(value: string | undefined): EnvelopeCipher {
    if (!value) {
      // Dev fallback — never use in production. Tests and local MCP host.
      return new EnvelopeCipher(Buffer.alloc(32, 7));
    }
    const key = Buffer.from(value, "base64");
    return new EnvelopeCipher(key);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString("base64");
  }

  decrypt(blob: string): string {
    const buf = Buffer.from(blob, "base64");
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  }
}
