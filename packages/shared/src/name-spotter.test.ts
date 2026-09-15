import { describe, expect, it } from "vitest";
import { isAssistantSpeaker, spotAddress } from "./name-spotter.ts";

describe("name-spotter", () => {
  it("emits assistant.addressed on Haitch, read the actions", () => {
    const hit = spotAddress("Haitch, read the actions", "Haitch (audio assistant)");
    expect(hit.addressed).toBe(true);
    expect(hit.trigger).toBe("name");
  });

  it("matches the word assistant", () => {
    expect(spotAddress("Hey assistant summarise that", "Haitch (audio assistant)").addressed).toBe(
      true,
    );
  });

  it("does not fire on unrelated speech", () => {
    expect(spotAddress("Let's ship Friday", "Haitch (audio assistant)").addressed).toBe(false);
  });

  it("classifies the assistant roster name as echo", () => {
    expect(isAssistantSpeaker("Haitch (audio assistant)", "Haitch (audio assistant)")).toBe(true);
    expect(isAssistantSpeaker("Simon Barnett", "Haitch (audio assistant)")).toBe(false);
  });
});
