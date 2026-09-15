import { describe, expect, it } from "vitest";
import { announceText, estimateDurationMs, EstimatedTts } from "./tts.ts";

describe("TTS helpers", () => {
  it("floors duration at 400ms and varies by voice", () => {
    expect(estimateDurationMs("Hi", "assistant_default")).toBe(400);
    expect(estimateDurationMs("one two three four five six seven eight nine ten", "assistant_brief")).toBeLessThan(
      estimateDurationMs("one two three four five six seven eight nine ten", "assistant_low"),
    );
  });

  it("strips parenthetical from the announce name", () => {
    expect(announceText("Haitch (audio assistant)")).toContain("This is Haitch,");
    expect(announceText("")).toContain("Haitch");
  });

  it("EstimatedTts returns duration only", async () => {
    const r = await new EstimatedTts().synthesize("Hello there friend", "assistant_default");
    expect(r.durationMs).toBeGreaterThanOrEqual(400);
  });
});
