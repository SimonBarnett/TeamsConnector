import type { MeetingRef, Participant } from "@teams-audio-join/shared";

export interface GraphTranscriptRef {
  id: string;
  createdDateTime?: string;
  contentUrl?: string;
}

export interface MeetingResolveInput {
  meetingUrl?: string;
  eventId?: string;
  onlineMeetingId?: string;
  graphUserId?: string;
}

export interface GraphMeetingClient {
  resolveMeeting(input: MeetingResolveInput): Promise<MeetingRef | null>;
  getParticipants(onlineMeetingId: string, graphUserId?: string): Promise<Participant[]>;
  listTranscripts(onlineMeetingId: string, graphUserId?: string): Promise<GraphTranscriptRef[]>;
  getTranscriptContent(ref: GraphTranscriptRef, graphUserId?: string): Promise<string>;
  /** Track A change notification. Return null to fall back to polling. */
  subscribeTranscripts?(
    onlineMeetingId: string,
    onNotify: () => void,
  ): Promise<{ id: string } | null>;
}

/**
 * Application-only OnlineMeetings.Read.All requires an application access policy
 * granted to the connecting user (or a service mailbox). Without it Graph returns
 * 404, which this connector maps to meeting_not_found — not a silent empty roster.
 *
 * GET /users/{id}/onlineMeetings?$filter=JoinWebUrl eq '{url}'
 * GET /users/{id}/onlineMeetings/{id}
 * GET /users/{id}/onlineMeetings/{id}/transcripts
 * GET …/transcripts/{tid}/content
 */
export const GRAPH_TRACK_A_OPS = [
  "GET /users/{id}/onlineMeetings?$filter=JoinWebUrl eq '{url}'",
  "GET /users/{id}/onlineMeetings/{id}",
  "GET /users/{id}/onlineMeetings/{id}/transcripts",
  "GET /users/{id}/onlineMeetings/{id}/transcripts/{tid}/content",
  "GET /users/{id}/onlineMeetings/getAllTranscripts",
  "POST /subscriptions (transcripts)",
] as const;
