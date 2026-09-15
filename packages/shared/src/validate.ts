import { ConnectorError } from "./errors.ts";
import {
  MODES,
  PLANE_REQUESTS,
  SPEAK_PRIORITIES,
  SPEAK_VOICES,
  SUMMARY_STYLES,
} from "./enums.ts";
import { isBcp47 } from "./locale.ts";
import { locatorCount } from "./meeting-url.ts";
import { ARTIFACT_ID_RE, IDEMPOTENCY_KEY_RE, isAgentId, ROUTINE_ID_RE, SESSION_ID_RE, UTTERANCE_ID_RE } from "./ids.ts";
import { matchHasLocator } from "./standing.ts";
import type {
  CallMeta,
  CancelSpeechRequest,
  GetTranscriptRequest,
  JoinMeetingRequest,
  LeaveMeetingRequest,
  RequestSummaryRequest,
  SpeakRequest,
  StandingMatch,
  StandingRoutine,
} from "./types.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConnectorError("invalid_argument", `${label} must be an object`, { field: label });
  }
  return value as Record<string, unknown>;
}

function unexpectedKeys(obj: Record<string, unknown>, allowed: string[], field: string): void {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    throw new ConnectorError("invalid_argument", `Unexpected properties: ${extra.join(", ")}`, {
      field,
      extra,
    });
  }
}

function reqString(obj: Record<string, unknown>, key: string, max: number, min = 1): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length < min || v.length > max) {
    throw new ConnectorError("invalid_argument", `${key} is invalid`, { field: key });
  }
  return v;
}

function optString(obj: Record<string, unknown>, key: string, max: number, min = 1): string | undefined {
  if (obj[key] === undefined) return undefined;
  return reqString(obj, key, max, min);
}

function optBool(obj: Record<string, unknown>, key: string): boolean | undefined {
  if (obj[key] === undefined) return undefined;
  if (typeof obj[key] !== "boolean") {
    throw new ConnectorError("invalid_argument", `${key} must be boolean`, { field: key });
  }
  return obj[key] as boolean;
}

function optInt(obj: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  if (obj[key] === undefined) return undefined;
  const v = obj[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new ConnectorError("invalid_argument", `${key} is out of range`, { field: key });
  }
  return v;
}

function oneOf<T extends string>(obj: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const v = obj[key];
  if (typeof v !== "string" || !allowed.includes(v as T)) {
    throw new ConnectorError("invalid_argument", `${key} is invalid`, { field: key });
  }
  return v as T;
}

function optOneOf<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  if (obj[key] === undefined) return undefined;
  return oneOf(obj, key, allowed);
}

export function validateMeta(raw: unknown): CallMeta {
  const obj = asRecord(raw ?? {}, "meta");
  unexpectedKeys(obj, ["tenantId", "userId", "agentId", "requestId", "idempotencyKey", "meetingConfirmed", "confirmStanding"], "meta");
  const tenantId = reqString(obj, "tenantId", 64);
  if (!UUID_RE.test(tenantId)) {
    throw new ConnectorError("invalid_argument", "tenantId must be a UUID", { field: "meta.tenantId" });
  }
  const userId = reqString(obj, "userId", 128);
  const agentId = reqString(obj, "agentId", 32);
  if (!isAgentId(agentId)) {
    throw new ConnectorError("invalid_argument", "agentId is invalid", { field: "meta.agentId" });
  }
  const requestId = optString(obj, "requestId", 64, 1);
  const idempotencyKey = optString(obj, "idempotencyKey", 128, 8);
  if (idempotencyKey && !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    throw new ConnectorError("invalid_argument", "idempotencyKey is invalid", { field: "meta.idempotencyKey" });
  }
  const meetingConfirmed = optBool(obj, "meetingConfirmed");
  const confirmStanding = optBool(obj, "confirmStanding");
  return { tenantId, userId, agentId, requestId, idempotencyKey, meetingConfirmed, confirmStanding };
}

export function validateJoinMeeting(raw: unknown): JoinMeetingRequest {
  const obj = asRecord(raw, "join_meeting");
  unexpectedKeys(obj, [
    "meetingUrl",
    "eventId",
    "onlineMeetingId",
    "mode",
    "announce",
    "plane",
    "locale",
    "waitForAdmitSec",
    "avatar",
  ], "join_meeting");
  const req: JoinMeetingRequest = {
    mode: optOneOf(obj, "mode", MODES) ?? "listen_speak",
    meetingUrl: optString(obj, "meetingUrl", 2048),
    eventId: optString(obj, "eventId", 256),
    onlineMeetingId: optString(obj, "onlineMeetingId", 256),
    announce: optBool(obj, "announce") ?? true,
    plane: optOneOf(obj, "plane", PLANE_REQUESTS) ?? "auto",
    locale: optString(obj, "locale", 32),
    waitForAdmitSec: optInt(obj, "waitForAdmitSec", 15, 180) ?? 60,
    avatar: optBool(obj, "avatar") ?? false,
  };
  if (req.meetingUrl) {
    try {
      const u = new URL(req.meetingUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error("bad proto");
      }
    } catch {
      throw new ConnectorError("invalid_argument", "meetingUrl must be a URI", { field: "meetingUrl" });
    }
  }
  if (req.locale && !isBcp47(req.locale)) {
    throw new ConnectorError("invalid_argument", "locale must be BCP-47", { field: "locale" });
  }
  const n = locatorCount(req);
  if (n === 0) {
    throw new ConnectorError("invalid_argument", "Exactly one meeting locator is required", {
      field: "meetingUrl|eventId|onlineMeetingId",
    });
  }
  if (n > 1) {
    throw new ConnectorError("invalid_argument", "Exactly one meeting locator is required", {
      field: "meetingUrl|eventId|onlineMeetingId",
    });
  }
  return req;
}

export function validateSessionId(raw: unknown, field = "sessionId"): string {
  if (typeof raw !== "string" || !SESSION_ID_RE.test(raw)) {
    throw new ConnectorError("invalid_argument", "sessionId is invalid", { field });
  }
  return raw;
}

export function validateGetTranscript(raw: unknown): GetTranscriptRequest {
  const obj = asRecord(raw, "get_transcript");
  unexpectedKeys(obj, ["sessionId", "sinceSeq", "limit", "includePartials"], "get_transcript");
  return {
    sessionId: validateSessionId(obj.sessionId),
    sinceSeq: optInt(obj, "sinceSeq", 0, Number.MAX_SAFE_INTEGER) ?? 0,
    limit: optInt(obj, "limit", 1, 500) ?? 200,
    includePartials: optBool(obj, "includePartials") ?? true,
  };
}

export function validateSpeak(raw: unknown): SpeakRequest {
  const obj = asRecord(raw, "speak");
  unexpectedKeys(obj, ["sessionId", "text", "priority", "voice", "allowBargeIn"], "speak");
  return {
    sessionId: validateSessionId(obj.sessionId),
    text: reqString(obj, "text", 280, 1),
    priority: optOneOf(obj, "priority", SPEAK_PRIORITIES) ?? "normal",
    voice: optOneOf(obj, "voice", SPEAK_VOICES) ?? "assistant_default",
    allowBargeIn: optBool(obj, "allowBargeIn") ?? true,
  };
}

export function validateCancelSpeech(raw: unknown): CancelSpeechRequest {
  const obj = asRecord(raw, "cancel_speech");
  unexpectedKeys(obj, ["sessionId", "utteranceId"], "cancel_speech");
  const utteranceId = optString(obj, "utteranceId", 64);
  if (utteranceId && !UTTERANCE_ID_RE.test(utteranceId)) {
    throw new ConnectorError("invalid_argument", "utteranceId is invalid", { field: "utteranceId" });
  }
  return { sessionId: validateSessionId(obj.sessionId), utteranceId };
}

export function validateRequestSummary(raw: unknown): RequestSummaryRequest {
  const obj = asRecord(raw, "request_summary");
  unexpectedKeys(obj, ["sessionId", "style", "refresh"], "request_summary");
  return {
    sessionId: validateSessionId(obj.sessionId),
    style: optOneOf(obj, "style", SUMMARY_STYLES) ?? "bullets",
    refresh: optBool(obj, "refresh") ?? false,
  };
}

export function validateLeave(raw: unknown): LeaveMeetingRequest {
  const obj = asRecord(raw, "leave_meeting");
  unexpectedKeys(obj, ["sessionId", "reason"], "leave_meeting");
  return {
    sessionId: validateSessionId(obj.sessionId),
    reason: optOneOf(obj, "reason", ["user_leave", "error"] as const) ?? "user_leave",
  };
}

export function validateStatus(raw: unknown): { sessionId: string } {
  const obj = asRecord(raw, "get_meeting_status");
  unexpectedKeys(obj, ["sessionId"], "get_meeting_status");
  return { sessionId: validateSessionId(obj.sessionId) };
}

function validateMatch(raw: unknown): StandingMatch {
  const obj = asRecord(raw, "match");
  unexpectedKeys(obj, ["subjectContains", "seriesMasterId", "eventId", "weekdays", "localTime"], "match");
  const match: StandingMatch = {
    subjectContains: optString(obj, "subjectContains", 128),
    seriesMasterId: optString(obj, "seriesMasterId", 256),
    eventId: optString(obj, "eventId", 256),
    localTime: optString(obj, "localTime", 5),
  };
  if (obj.weekdays !== undefined) {
    if (!Array.isArray(obj.weekdays) || obj.weekdays.some((n) => typeof n !== "number" || n < 1 || n > 7 || !Number.isInteger(n))) {
      throw new ConnectorError("invalid_argument", "weekdays must be integers 1–7 (Mon=1)", { field: "match.weekdays" });
    }
    match.weekdays = obj.weekdays as number[];
  }
  if (match.localTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(match.localTime)) {
    throw new ConnectorError("invalid_argument", "localTime must be HH:MM", { field: "match.localTime" });
  }
  if (!matchHasLocator(match)) {
    throw new ConnectorError("invalid_argument", "match needs subjectContains, seriesMasterId, or eventId", {
      field: "match",
    });
  }
  return match;
}

export function validateUpsertRoutine(raw: unknown): Omit<StandingRoutine, "tenantId" | "userId" | "createdAt" | "routineId"> & { routineId?: string } {
  const obj = asRecord(raw, "upsert_standing_routine");
  unexpectedKeys(obj, ["routineId", "label", "enabled", "mode", "plane", "avatar", "match", "hoursDraft", "ownerMemo"], "upsert_standing_routine");
  const mode = optOneOf(obj, "mode", MODES) ?? "listen_speak";
  const routineId = optString(obj, "routineId", 64);
  if (routineId && !ROUTINE_ID_RE.test(routineId)) {
    throw new ConnectorError("invalid_argument", "routineId is invalid", { field: "routineId" });
  }
  return {
    routineId,
    label: reqString(obj, "label", 80),
    enabled: optBool(obj, "enabled") ?? true,
    mode,
    plane: optOneOf(obj, "plane", ["auto", "transcript"] as const) ?? "auto",
    avatar: optBool(obj, "avatar") ?? false,
    match: validateMatch(obj.match),
    hoursDraft: optBool(obj, "hoursDraft") ?? true,
    ownerMemo: optBool(obj, "ownerMemo") ?? false,
  };
}

export function validateDeleteRoutine(raw: unknown): { routineId: string } {
  const obj = asRecord(raw, "delete_standing_routine");
  unexpectedKeys(obj, ["routineId"], "delete_standing_routine");
  const routineId = reqString(obj, "routineId", 64);
  if (!ROUTINE_ID_RE.test(routineId)) {
    throw new ConnectorError("invalid_argument", "routineId is invalid", { field: "routineId" });
  }
  return { routineId };
}

export function validatePrepareHoursDraft(raw: unknown): { sessionId: string } {
  const obj = asRecord(raw, "prepare_hours_draft");
  unexpectedKeys(obj, ["sessionId"], "prepare_hours_draft");
  return { sessionId: validateSessionId(obj.sessionId) };
}

export { ARTIFACT_ID_RE };
