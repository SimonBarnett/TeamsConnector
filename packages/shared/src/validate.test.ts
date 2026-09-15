import { describe, expect, it } from "vitest";
import { ConnectorError } from "./errors.ts";
import { newSessionId } from "./ids.ts";
import {
  validateCancelSpeech,
  validateDeleteRoutine,
  validateGetTranscript,
  validateJoinMeeting,
  validateLeave,
  validateMeta,
  validatePrepareHoursDraft,
  validateRequestSummary,
  validateSpeak,
  validateStatus,
  validateUpsertRoutine,
} from "./validate.ts";

const TENANT = "11111111-2222-3333-4444-555555555555";

describe("validateJoinMeeting", () => {
  it("defaults to listen_speak and announce true", () => {
    const req = validateJoinMeeting({ onlineMeetingId: "om-1" });
    expect(req.mode).toBe("listen_speak");
    expect(req.announce).toBe(true);
    expect(req.plane).toBe("auto");
  });

  it("rejects extra properties and bad locale", () => {
    expect(() => validateJoinMeeting({ onlineMeetingId: "om-1", extra: true })).toThrow(ConnectorError);
    expect(() => validateJoinMeeting({ onlineMeetingId: "om-1", locale: "english" })).toThrow(ConnectorError);
  });
});

describe("validateSpeak / transcript / leave", () => {
  const sessionId = newSessionId();

  it("caps speak text at 280 and requires sessionId", () => {
    expect(validateSpeak({ sessionId, text: "Hi" }).priority).toBe("normal");
    expect(() => validateSpeak({ sessionId, text: "x".repeat(281) })).toThrow(ConnectorError);
    expect(() => validateSpeak({ sessionId: "nope", text: "Hi" })).toThrow(ConnectorError);
  });

  it("defaults get_transcript paging", () => {
    const t = validateGetTranscript({ sessionId });
    expect(t.sinceSeq).toBe(0);
    expect(t.limit).toBe(200);
    expect(t.includePartials).toBe(true);
  });

  it("validates leave, status, cancel, summary, hours draft", () => {
    expect(validateLeave({ sessionId }).reason).toBe("user_leave");
    expect(validateStatus({ sessionId }).sessionId).toBe(sessionId);
    expect(validateCancelSpeech({ sessionId }).utteranceId).toBeUndefined();
    expect(validateRequestSummary({ sessionId }).style).toBe("bullets");
    expect(validatePrepareHoursDraft({ sessionId }).sessionId).toBe(sessionId);
  });
});

describe("validateMeta and standing CRUD", () => {
  it("requires UUID tenant and agent id", () => {
    expect(() => validateMeta({ tenantId: "nope", userId: "u", agentId: "haitch" })).toThrow(ConnectorError);
    expect(validateMeta({ tenantId: TENANT, userId: "u", agentId: "haitch" }).agentId).toBe("haitch");
  });

  it("defaults standing routines to listen_speak and requires a locator", () => {
    const r = validateUpsertRoutine({ label: "Standup", match: { eventId: "evt-1" } });
    expect(r.mode).toBe("listen_speak");
    expect(r.hoursDraft).toBe(true);
    expect(() => validateUpsertRoutine({ label: "x", match: {} })).toThrow(ConnectorError);
    expect(() => validateDeleteRoutine({ routineId: "bad" })).toThrow(ConnectorError);
  });
});
