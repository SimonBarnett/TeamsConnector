import { describe, expect, it } from "vitest";
import { EnvelopeCipher } from "./crypto.ts";

describe("EnvelopeCipher", () => {
  it("round-trips plaintext and rejects short keys", () => {
    const c = new EnvelopeCipher(Buffer.alloc(32, 9));
    const blob = c.encrypt("secret notes");
    expect(blob).not.toContain("secret notes");
    expect(c.decrypt(blob)).toBe("secret notes");
    expect(() => new EnvelopeCipher(Buffer.alloc(16))).toThrow(/32 bytes/);
  });

  it("fromEnv uses a dev fallback when unset", () => {
    const a = EnvelopeCipher.fromEnv(undefined);
    const b = EnvelopeCipher.fromEnv(undefined);
    expect(b.decrypt(a.encrypt("x"))).toBe("x");
  });
});
