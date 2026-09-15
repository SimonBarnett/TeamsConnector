import { describe, expect, it } from "vitest";
import { speakBlockedReason } from "./content-filter.ts";

describe("speak content filter", () => {
  it("allows ordinary meeting speech", () => {
    expect(speakBlockedReason("I will be two minutes late.")).toBeUndefined();
  });

  it("rejects SSML, join URLs, and secrets", () => {
    expect(speakBlockedReason("<speak>hello</speak>")).toBeDefined();
    expect(speakBlockedReason("Join https://teams.microsoft.com/l/meetup-join/19%3ameeting")).toBeDefined();
    expect(speakBlockedReason("The token is Bearer abcdefghijklmnop")).toBeDefined();
  });
});
