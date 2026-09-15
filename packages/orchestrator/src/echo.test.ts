import { describe, expect, it } from "vitest";
import { matchEcho, tokenF1 } from "./echo.ts";

describe("echo classifier", () => {
  it("matches speak() text as assistant echo", () => {
    const played = [{ utteranceId: "utt_01K7Q3N8R2M0K7V1C4D8E2F6GH", text: "I will capture the actions." }];
    expect(tokenF1("I will capture the actions", played[0]!.text)).toBeGreaterThanOrEqual(0.7);
    expect(matchEcho("I will capture the actions.", played)?.utteranceId).toBe(played[0]!.utteranceId);
  });

  it("does not treat unrelated human speech as echo", () => {
    const played = [{ utteranceId: "utt_01K7Q3N8R2M0K7V1C4D8E2F6GH", text: "I will capture the actions." }];
    expect(matchEcho("Alex will send the deck on Friday", played)).toBeUndefined();
  });
});
