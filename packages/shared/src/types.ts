import type {
  EndedReason,
  ErrorCode,
  EventType,
  LeaveStatus,
  Mode,
  ParticipantRole,
  Plane,
  PlaneRequest,
  SegmentSource,
  SessionState,
  SpeakerKind,
  SpeakPriority,
  SpeakStatus,
  SpeakVoice,
  SttQuality,
  SummaryStyle,
} from "./enums.ts";
import type { ConnectorErrorBody } from "./errors.ts";

export interface CallMeta {
  tenantId: string;
  userId: string;
  agentId: string;
  requestId?: string;
  idempotencyKey?: string;
  meetingConfirmed?: boolean;
}

export interface MeetingOrganizer {
  id?: string;
  displayName?: string;
}

export interface MeetingRef {
  onlineMeetingId?: string;
  eventId?: string;
  subject?: string;
  startAt?: string;
  endAt?: string;
  joinUrlRedacted?: string;
  organizer?: MeetingOrganizer;
}

export interface Participant {
  id: string;
  displayName: string;
  role?: ParticipantRole;
  inMeeting: boolean;
  isAssistant?: boolean;
  joinedAt?: string;
}

export interface Capabilities {
  canHear: boolean;
  canSpeak: boolean;
  stt: SttQuality;
}

export interface TranscriptSegment {
  seq: number;
  tMs: number;
  endMs: number;
  speaker: string;
  speakerId?: string;
  speakerKind: SpeakerKind;
  text: string;
  isPartial: boolean;
  confidence?: number;
  source: SegmentSource;
  addressedToAssistant?: boolean;
  linkedUtteranceId?: string;
  redacted?: boolean;
}

export interface ActionItem {
  text: string;
  owner?: string;
  ownerId?: string;
  due?: string;
  confidence: number;
}

export interface HoursHint {
  hours: number;
  label: string;
  billableSuggested: boolean;
}

export interface Artifact {
  artifactId: string;
  sessionId: string;
  style: SummaryStyle;
  partial: boolean;
  createdAt: string;
  summary: string;
  decisions: string[];
  actions: ActionItem[];
  openQuestions: string[];
  hoursHint?: HoursHint;
  groundedSeqRange: { from: number; to: number };
}

export interface SpeakQuota {
  utterancesUsed?: number;
  utterancesMax?: number;
  cooldownEndsAt?: string;
}

export interface JoinMeetingRequest {
  meetingUrl?: string;
  eventId?: string;
  onlineMeetingId?: string;
  mode: Mode;
  announce?: boolean;
  plane?: PlaneRequest;
  locale?: string;
  waitForAdmitSec?: number;
}

export interface JoinMeetingResponse {
  sessionId: string;
  state: SessionState;
  plane: Plane;
  mode: Mode;
  createdAt: string;
  resumed?: boolean;
  meeting: MeetingRef;
  capabilities: Capabilities;
}

export interface SessionRequest {
  sessionId: string;
}

export interface GetMeetingStatusResponse {
  sessionId: string;
  state: SessionState;
  plane: Plane;
  mode: Mode;
  startedAt?: string;
  admittedAt?: string;
  endedAt?: string;
  participants: Participant[];
  capabilities: Capabilities;
  lastError?: ConnectorErrorBody;
  speak?: SpeakQuota;
}

export interface GetTranscriptRequest {
  sessionId: string;
  sinceSeq?: number;
  limit?: number;
  includePartials?: boolean;
}

export interface GetTranscriptResponse {
  sessionId: string;
  segments: TranscriptSegment[];
  nextSeq: number;
  ended: boolean;
  canHear: boolean;
}

export interface SpeakRequest {
  sessionId: string;
  text: string;
  priority?: SpeakPriority;
  voice?: SpeakVoice;
  allowBargeIn?: boolean;
}

export interface SpeakResponse {
  utteranceId: string;
  status: "queued" | "playing" | "rejected";
  reason?: string;
  estimatedDurationMs?: number;
  error?: ConnectorErrorBody;
}

export interface CancelSpeechRequest {
  sessionId: string;
  utteranceId?: string;
}

export interface CancelSpeechResponse {
  cancelled: string[];
  status: "cancelled" | "nothing_playing";
}

export interface RequestSummaryRequest {
  sessionId: string;
  style?: SummaryStyle;
  refresh?: boolean;
}

export interface LeaveMeetingRequest {
  sessionId: string;
  reason?: "user_leave" | "error";
}

export interface LeaveMeetingResponse {
  sessionId: string;
  status: LeaveStatus;
  endedAt: string;
  artifactId?: string;
}

export interface EventEnvelope {
  eventId: string;
  type: EventType;
  occurredAt: string;
  tenantId: string;
  sessionId: string;
  agentId?: string;
  payload: Record<string, unknown>;
}

export interface SessionRecord {
  sessionId: string;
  tenantId: string;
  userId: string;
  agentId: string;
  state: SessionState;
  plane: Plane;
  mode: Mode;
  createdAt: string;
  startedAt?: string;
  admittedAt?: string;
  endedAt?: string;
  endedReason?: EndedReason;
  meeting: MeetingRef;
  meetingKey: string;
  locale?: string;
  announce: boolean;
  waitForAdmitSec: number;
  capabilities: Capabilities;
  participants: Participant[];
  lastError?: ConnectorErrorBody;
  speak: SpeakQuota;
  lastArtifactId?: string;
}

export type { ErrorCode, ConnectorErrorBody };
