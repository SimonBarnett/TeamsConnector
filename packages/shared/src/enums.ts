export const SESSION_STATES = [
  "queued",
  "resolving",
  "awaiting_consent",
  "joining",
  "in_lobby",
  "listening",
  "listening_deaf",
  "speaking_enabled",
  "leaving",
  "ended",
  "failed",
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const PLANES = ["transcript", "media"] as const;
export type Plane = (typeof PLANES)[number];

export const PLANE_REQUESTS = ["auto", "transcript", "media"] as const;
export type PlaneRequest = (typeof PLANE_REQUESTS)[number];

export const MODES = ["listen", "listen_speak"] as const;
export type Mode = (typeof MODES)[number];

export const STT_QUALITIES = ["live", "official", "degraded", "none"] as const;
export type SttQuality = (typeof STT_QUALITIES)[number];

export const PARTICIPANT_ROLES = [
  "organizer",
  "presenter",
  "attendee",
  "assistant",
  "guest",
  "unknown",
] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const SPEAK_PRIORITIES = ["normal", "urgent"] as const;
export type SpeakPriority = (typeof SPEAK_PRIORITIES)[number];

export const SPEAK_STATUSES = ["queued", "playing", "played", "played_locally", "cancelled", "rejected"] as const;
export type SpeakStatus = (typeof SPEAK_STATUSES)[number];

export const SUMMARY_STYLES = ["bullets", "memo", "hours"] as const;
export type SummaryStyle = (typeof SUMMARY_STYLES)[number];

export const LEAVE_STATUSES = ["left", "already_ended"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const ENDED_REASONS = [
  "user_leave",
  "meeting_ended",
  "ejected",
  "lobby_timeout",
  "error",
] as const;
export type EndedReason = (typeof ENDED_REASONS)[number];

export const SPEAKER_KINDS = ["human", "assistant", "unknown"] as const;
export type SpeakerKind = (typeof SPEAKER_KINDS)[number];

export const SEGMENT_SOURCES = [
  "stt_live",
  "stt_final",
  "teams_official",
  "agent_tts_echo",
  "owner_command",
] as const;
export type SegmentSource = (typeof SEGMENT_SOURCES)[number];

export const EVENT_TYPES = [
  "session.updated",
  "participant.joined",
  "participant.left",
  "transcript.delta",
  "assistant.addressed",
  "speak.finished",
  "speak.rejected",
  "session.ended",
  "artifact.ready",
  "hours.draft_ready",
  "owner.memo",
  "routine.fired",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ERROR_CODES = [
  "unauthenticated",
  "consent_required",
  "policy_denied",
  "policy_missing",
  "meeting_not_found",
  "lobby_timeout",
  "media_permission_denied",
  "plane_unavailable",
  "mode_unsupported",
  "session_not_found",
  "speak_rejected",
  "speak_capped",
  "content_filtered",
  "stt_degraded",
  "dependency_unavailable",
  "invalid_argument",
  "conflict",
  "rate_limited",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const SPEAK_VOICES = ["assistant_default", "assistant_low", "assistant_brief"] as const;
export type SpeakVoice = (typeof SPEAK_VOICES)[number];

export const LIVE_STATES: ReadonlySet<SessionState> = new Set([
  "queued",
  "resolving",
  "awaiting_consent",
  "joining",
  "in_lobby",
  "listening",
  "listening_deaf",
  "speaking_enabled",
  "leaving",
]);
