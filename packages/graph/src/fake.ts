import { redactJoinUrl, type MeetingRef, type Participant } from "@teams-audio-join/shared";
import type { GraphMeetingClient, GraphTranscriptRef, MeetingResolveInput } from "./client.ts";

export interface FakeMeeting {
  meeting: MeetingRef;
  joinUrl?: string;
  eventId?: string;
  participants?: Participant[];
  transcripts?: { id: string; content: string }[];
}

export class FakeGraphClient implements GraphMeetingClient {
  transcriptionEnabled = true;
  failResolve = false;

  constructor(public meetings: FakeMeeting[] = []) {}

  async resolveMeeting(input: MeetingResolveInput): Promise<MeetingRef | null> {
    if (this.failResolve) return null;
    const found = this.meetings.find((m) => {
      if (input.onlineMeetingId && m.meeting.onlineMeetingId === input.onlineMeetingId) return true;
      if (input.eventId && (m.eventId === input.eventId || m.meeting.eventId === input.eventId)) return true;
      if (input.meetingUrl && m.joinUrl) {
        return redactJoinUrl(m.joinUrl) === redactJoinUrl(input.meetingUrl);
      }
      return false;
    });
    return found ? { ...found.meeting, joinUrlRedacted: found.meeting.joinUrlRedacted ?? (found.joinUrl ? redactJoinUrl(found.joinUrl) : undefined) } : null;
  }

  async getParticipants(onlineMeetingId: string): Promise<Participant[]> {
    return this.meetings.find((m) => m.meeting.onlineMeetingId === onlineMeetingId)?.participants ?? [];
  }

  async listTranscripts(onlineMeetingId: string): Promise<GraphTranscriptRef[]> {
    if (!this.transcriptionEnabled) return [];
    const m = this.meetings.find((x) => x.meeting.onlineMeetingId === onlineMeetingId);
    return (m?.transcripts ?? []).map((t) => ({ id: t.id, contentUrl: t.id }));
  }

  async getTranscriptContent(ref: GraphTranscriptRef): Promise<string> {
    for (const m of this.meetings) {
      const hit = m.transcripts?.find((t) => t.id === ref.id);
      if (hit) return hit.content;
    }
    return "";
  }
}

export function fixtureCatchup(): FakeMeeting {
  const joinUrl =
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=%7B%7D&pwd=SECRET99";
  return {
    joinUrl,
    eventId: "evt-priority",
    meeting: {
      onlineMeetingId: "om-priority",
      eventId: "evt-priority",
      subject: "Priority wider catchup",
      startAt: "2026-09-15T12:00:00.000Z",
      endAt: "2026-09-15T13:00:00.000Z",
      joinUrlRedacted: redactJoinUrl(joinUrl),
      organizer: { id: "user-simon", displayName: "Simon Barnett" },
    },
    participants: [
      {
        id: "user-simon",
        displayName: "Simon Barnett",
        role: "organizer",
        inMeeting: true,
        joinedAt: "2026-09-15T12:00:05.000Z",
      },
      {
        id: "bot-haitch",
        displayName: "Haitch (audio assistant)",
        role: "assistant",
        inMeeting: true,
        isAssistant: true,
        joinedAt: "2026-09-15T12:00:08.000Z",
      },
    ],
    transcripts: [
      {
        id: "tr-1",
        content: `WEBVTT

00:00:01.000 --> 00:00:04.000
<v Simon Barnett>We should ship Friday if QA is green.

00:00:05.000 --> 00:00:08.000
<v Haitch (audio assistant)>Noted, I will capture actions.

00:00:09.000 --> 00:00:13.000
<v Simon Barnett>Haitch, read the actions.

00:00:20.000 --> 00:00:35.000
<v Simon Barnett>Action: Alex will send the deck. The token is Bearer not-a-real-token-value-12345.
`,
      },
    ],
  };
}
