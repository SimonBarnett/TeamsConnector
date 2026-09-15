import { redactJoinUrl, type MeetingRef, type Participant } from "@teams-audio-join/shared";
import type { GraphMeetingClient, GraphTranscriptRef, MeetingResolveInput } from "./client.ts";

export interface TokenProvider {
  getToken(): Promise<string>;
}

export class ClientCredentialsTokenProvider implements TokenProvider {
  constructor(
    private readonly opts: {
      tenantId: string;
      clientId: string;
      clientSecret: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async getToken(): Promise<string> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const body = new URLSearchParams({
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });
    const res = await fetchImpl(`https://login.microsoftonline.com/${this.opts.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`token ${res.status}`);
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) throw new Error("token missing");
    return json.access_token;
  }
}

/**
 * Track A Graph adapter. App-only reads require an application access policy
 * on the connecting user / service mailbox (see docs/admin-install.md).
 */
export class GraphRestClient implements GraphMeetingClient {
  constructor(
    private readonly tokens: TokenProvider,
    private readonly defaultUserId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async graph(path: string, accept?: string): Promise<Response> {
    const token = await this.tokens.getToken();
    return this.fetchImpl(`https://graph.microsoft.com/v1.0${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: accept ?? "application/json",
      },
    });
  }

  async resolveMeeting(input: MeetingResolveInput): Promise<MeetingRef | null> {
    const user = input.graphUserId ?? this.defaultUserId;
    if (input.onlineMeetingId) {
      const res = await this.graph(`/users/${encodeURIComponent(user)}/onlineMeetings/${encodeURIComponent(input.onlineMeetingId)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`graph ${res.status}`);
      return this.toRef(await res.json());
    }
    if (input.meetingUrl) {
      const filter = encodeURIComponent(`JoinWebUrl eq '${input.meetingUrl.replace(/'/g, "''")}'`);
      const res = await this.graph(`/users/${encodeURIComponent(user)}/onlineMeetings?$filter=${filter}`);
      if (!res.ok) throw new Error(`graph ${res.status}`);
      const json = (await res.json()) as { value?: unknown[] };
      const first = json.value?.[0];
      return first ? this.toRef(first) : null;
    }
    if (input.eventId) {
      const res = await this.graph(
        `/users/${encodeURIComponent(user)}/events/${encodeURIComponent(input.eventId)}?$select=onlineMeeting,subject,start,end,organizer`,
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`graph ${res.status}`);
      const event = (await res.json()) as {
        subject?: string;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
        onlineMeeting?: { joinUrl?: string };
        organizer?: { emailAddress?: { name?: string; address?: string } };
      };
      if (!event.onlineMeeting?.joinUrl) return null;
      const viaUrl = await this.resolveMeeting({ meetingUrl: event.onlineMeeting.joinUrl, graphUserId: user });
      if (viaUrl) {
        viaUrl.eventId = input.eventId;
        viaUrl.subject = viaUrl.subject ?? event.subject;
        return viaUrl;
      }
      return {
        eventId: input.eventId,
        subject: event.subject,
        startAt: event.start?.dateTime,
        endAt: event.end?.dateTime,
        joinUrlRedacted: redactJoinUrl(event.onlineMeeting.joinUrl),
      };
    }
    return null;
  }

  async getParticipants(onlineMeetingId: string, graphUserId?: string): Promise<Participant[]> {
    const user = graphUserId ?? this.defaultUserId;
    const res = await this.graph(
      `/users/${encodeURIComponent(user)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}?$expand=participants`,
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      participants?: { id?: string; upn?: string; displayName?: string; role?: string }[];
    };
    return (json.participants ?? []).map((p) => ({
      id: p.id ?? p.upn ?? "unknown",
      displayName: p.displayName || "Unknown",
      inMeeting: true,
    }));
  }

  async listTranscripts(onlineMeetingId: string, graphUserId?: string): Promise<GraphTranscriptRef[]> {
    const user = graphUserId ?? this.defaultUserId;
    const res = await this.graph(
      `/users/${encodeURIComponent(user)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/transcripts`,
    );
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`graph ${res.status}`);
    const json = (await res.json()) as { value?: { id: string; createdDateTime?: string }[] };
    return json.value ?? [];
  }

  async getTranscriptContent(ref: GraphTranscriptRef, graphUserId?: string): Promise<string> {
    const user = graphUserId ?? this.defaultUserId;
    const path = ref.contentUrl
      ? undefined
      : `/users/${encodeURIComponent(user)}/onlineMeetings/transcripts/${encodeURIComponent(ref.id)}/content`;
    const token = await this.tokens.getToken();
    const url = ref.contentUrl ?? `https://graph.microsoft.com/v1.0${path}`;
    const res = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${token}`, accept: "text/vtt, application/json" },
    });
    if (!res.ok) throw new Error(`graph content ${res.status}`);
    return res.text();
  }

  private toRef(raw: unknown): MeetingRef {
    const o = raw as {
      id?: string;
      subject?: string;
      startDateTime?: string;
      endDateTime?: string;
      joinWebUrl?: string;
      participants?: { organizer?: { identity?: { user?: { id?: string; displayName?: string } } } };
    };
    const ref: MeetingRef = {
      onlineMeetingId: o.id,
      subject: o.subject,
      startAt: o.startDateTime,
      endAt: o.endDateTime,
    };
    if (o.joinWebUrl) ref.joinUrlRedacted = redactJoinUrl(o.joinWebUrl);
    const org = o.participants?.organizer?.identity?.user;
    if (org) ref.organizer = { id: org.id, displayName: org.displayName };
    return ref;
  }
}
