import { describe, expect, it } from "vitest";
import { classifyCaptions } from "./classify.ts";

describe("classifyCaptions", () => {
  it("labels humans, assistant roster, echo, address, and redaction", () => {
    const segs = classifyCaptions(
      [
        { tMs: 0, endMs: 1000, speaker: "Simon Barnett", text: "Hello" },
        { tMs: 1000, endMs: 2000, speaker: "Haitch (audio assistant)", text: "Noted" },
        { tMs: 2000, endMs: 3000, speaker: "Simon Barnett", text: "I will capture the actions." },
        { tMs: 3000, endMs: 4000, speaker: "Alex", text: "Haitch, read the actions" },
        { tMs: 4000, endMs: 5000, speaker: "Alex", text: "token Bearer abcdefghijklmnop" },
      ],
      0,
      "Haitch (audio assistant)",
      [],
      [{ utteranceId: "utt_01K7Q3N8R2M0K7V1C4D8E2F6GH", text: "I will capture the actions." }],
    );
    expect(segs[0]?.speakerKind).toBe("human");
    expect(segs[1]?.speakerKind).toBe("assistant");
    expect(segs[1]?.source).toBe("agent_tts_echo");
    expect(segs[2]?.linkedUtteranceId).toBe("utt_01K7Q3N8R2M0K7V1C4D8E2F6GH");
    expect(segs[3]?.addressedToAssistant).toBe(true);
    expect(segs[4]?.redacted).toBe(true);
    expect(segs[4]?.text).not.toContain("abcdefghijklmnop");
  });
});
