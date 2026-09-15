import { describe, expect, it } from "vitest";
import {
  ARTIFACT_ID_RE,
  isAgentId,
  newArtifactId,
  newSessionId,
  newUtteranceId,
  SESSION_ID_RE,
  UTTERANCE_ID_RE,
} from "./ids.ts";

describe("ids", () => {
  it("emits Crockford ULIDs with the required prefixes", () => {
    expect(newSessionId()).toMatch(SESSION_ID_RE);
    expect(newUtteranceId()).toMatch(UTTERANCE_ID_RE);
    expect(newArtifactId()).toMatch(ARTIFACT_ID_RE);
  });

  it("rejects I, L, O, U in the entropy alphabet", () => {
    const id = newSessionId().slice(4);
    expect(id).not.toMatch(/[ILOU]/);
  });

  it("accepts documented agent ids", () => {
    expect(isAgentId("haitch")).toBe(true);
    expect(isAgentId("eshbel")).toBe(true);
    expect(isAgentId("jester")).toBe(true);
    expect(isAgentId("Haitch")).toBe(false);
    expect(isAgentId("x")).toBe(false);
  });
});
