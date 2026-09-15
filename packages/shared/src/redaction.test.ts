import { describe, expect, it } from "vitest";
import { looksLikeAudioBlobName, redactSecrets } from "./redaction.ts";

describe("redaction", () => {
  it("redacts join passwords, bearer tokens, and JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.signaturexx";
    const input = `join pwd=hunter2 Bearer abcdefghijklmnop token ${jwt}`;
    const { text, redacted } = redactSecrets(input);
    expect(redacted).toBe(true);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).not.toContain(jwt);
    expect(text).toContain("[redacted]");
  });

  it("leaves ordinary meeting speech alone", () => {
    const { text, redacted } = redactSecrets("Simon will send the deck on Friday.");
    expect(redacted).toBe(false);
    expect(text).toBe("Simon will send the deck on Friday.");
  });

  it("flags audio blob names", () => {
    expect(looksLikeAudioBlobName("session.wav")).toBe(true);
    expect(looksLikeAudioBlobName("frames.pcm")).toBe(true);
    expect(looksLikeAudioBlobName("notes.json")).toBe(false);
  });
});
