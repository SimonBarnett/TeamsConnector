import { createPrivateKey, createSign, X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  normalizeJoinWebUrl,
  redactJoinUrl,
  threadIdFromJoinUrl,
  type MeetingRef,
  type Participant,
  type ParticipantRole,
} from "@teams-audio-join/shared";
import type { GraphMeetingClient, GraphTranscriptRef, MeetingResolveInput } from "./client.ts";
import { GraphHttpError } from "./http-error.ts";

export interface TokenProvider {
  getToken(): Promise<string>;
}

function odataString(value: string): string {
  return value.replace(/'/g, "''");
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

function loadCertificatePem(value: string): string {
  if (existsSync(value)) return readFileSync(value, "utf8");
  return value.replace(/\\n/g, "\n");
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

export function clientAssertionJwt(opts: { tenantId: string; clientId: string; pem: string; nowSec?: number }): string {
  const cert = new X509Certificate(opts.pem);
  const key = createPrivateKey(opts.pem);
  const sha1 = cert.fingerprint.replace(/:/g, "");
  const x5t = Buffer.from(sha1, "hex").toString("base64url");
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", x5t };
  const payload = {
    aud: `https://login.microsoftonline.com/${opts.tenantId}/oauth2/v2.0/token`,
    iss: opts.clientId,
    sub: opts.clientId,
    jti: `${now}`,
    nbf: now,
    exp: now + 600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  return `${unsigned}.${signer.sign(key).toString("base64url")}`;
}

/** Entra app-only token using AZURE_CLIENT_CERTIFICATE (PEM path or PEM contents). */
export class ClientCertificateTokenProvider implements TokenProvider {
  constructor(
    private readonly opts: {
      tenantId: string;
      clientId: string;
      certificate: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async getToken(): Promise<string> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const pem = loadCertificatePem(this.opts.certificate);
    const assertion = clientAssertionJwt({
      tenantId: this.opts.tenantId,
      clientId: this.opts.clientId,
      pem,
    });
    const body = new URLSearchParams({
      client_id: this.opts.clientId,
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
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

  async probeAccessPolicy(): Promise<void> {
    const user = this.defaultUserId;
    const res = await this.graph(`/users/${encodeURIComponent(user)}/onlineMeetings?$top=1`);
    if (!res.ok) {
      throw new GraphHttpError(res.status, await res.text(), { collection: true });
    }
  }

  async resolveMeeting(input: MeetingResolveInput): Promise<MeetingRef | null> {
    const user = input.graphUserId ?? this.defaultUserId;
    if (input.onlineMeetingId) {
      const res = await this.graph(`/users/${encodeURIComponent(user)}/onlineMeetings/${encodeURIComponent(input.onlineMeetingId)}`);
      if (res.status === 404) {
        const err = new GraphHttpError(404, await res.text());
        if (err.connectorCode === "policy_missing") throw err;
        return null;
      }
      if (!res.ok) throw new GraphHttpError(res.status, await res.text());
      return this.toRef(await res.json());
    }
    if (input.meetingUrl) {
      return this.resolveByJoinUrl(user, input.meetingUrl);
    }
    if (input.eventId) {
      const res = await this.graph(
        `/users/${encodeURIComponent(user)}/events/${encodeURIComponent(input.eventId)}?$select=onlineMeeting,subject,start,end,organizer`,
      );
      if (res.status === 404) {
        const err = new GraphHttpError(404, await res.text());
        if (err.connectorCode === "policy_missing") throw err;
        return null;
      }
      if (!res.ok) throw new GraphHttpError(res.status, await res.text());
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

  private async resolveByJoinUrl(user: string, meetingUrl: string): Promise<MeetingRef | null> {
    const normalized = normalizeJoinWebUrl(meetingUrl);
    const thread = threadIdFromJoinUrl(meetingUrl);
    const filter = encodeURIComponent(`JoinWebUrl eq '${odataString(normalized)}'`);
    const filtered = await this.graph(`/users/${encodeURIComponent(user)}/onlineMeetings?$filter=${filter}`);
    if (filtered.ok) {
      const json = (await filtered.json()) as { value?: unknown[] };
      const first = json.value?.[0];
      if (first) return this.toRef(first);
    } else if (filtered.status === 400) {
      await filtered.text();
    } else {
      throw new GraphHttpError(filtered.status, await filtered.text(), { collection: true });
    }
    if (!thread) return null;
    const list = await this.graph(`/users/${encodeURIComponent(user)}/onlineMeetings?$top=50`);
    if (!list.ok) throw new GraphHttpError(list.status, await list.text(), { collection: true });
    const json = (await list.json()) as { value?: { joinWebUrl?: string }[] };
    const hit = (json.value ?? []).find((m) => m.joinWebUrl && threadIdFromJoinUrl(m.joinWebUrl) === thread);
    return hit ? this.toRef(hit) : null;
  }

  async getParticipants(onlineMeetingId: string, graphUserId?: string): Promise<Participant[]> {
    const user = graphUserId ?? this.defaultUserId;
    const reportsRes = await this.graph(
      `/users/${encodeURIComponent(user)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/attendanceReports`,
    );
    if (!reportsRes.ok) {
      throw new GraphHttpError(reportsRes.status, await reportsRes.text());
    }
    const reports = (await reportsRes.json()) as {
      value?: { id?: string; meetingEndDateTime?: string }[];
    };
    const report = (reports.value ?? []).sort((a, b) =>
      String(b.meetingEndDateTime ?? "").localeCompare(String(a.meetingEndDateTime ?? "")),
    )[0];
    if (!report?.id) return [];

    const recRes = await this.graph(
      `/users/${encodeURIComponent(user)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/attendanceReports/${encodeURIComponent(report.id)}/attendanceRecords`,
    );
    if (!recRes.ok) {
      throw new GraphHttpError(recRes.status, await recRes.text());
    }
    const recs = (await recRes.json()) as {
      value?: {
        id?: string;
        emailAddress?: string;
        role?: string;
        identity?: {
          id?: string;
          displayName?: string;
          user?: { id?: string; displayName?: string };
        };
      }[];
    };
    return (recs.value ?? []).map((p) => {
      const ident = p.identity?.user ?? p.identity;
      return {
        id: ident?.id ?? p.emailAddress ?? p.id ?? "unknown",
        displayName: ident?.displayName || p.emailAddress || "Unknown",
        role: mapAttendanceRole(p.role),
        inMeeting: true,
      };
    });
  }

  async listTranscripts(onlineMeetingId: string, graphUserId?: string): Promise<GraphTranscriptRef[]> {
    const user = graphUserId ?? this.defaultUserId;
    const res = await this.graph(
      `/users/${encodeURIComponent(user)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}/transcripts`,
    );
    if (res.status === 404) return [];
    if (!res.ok) throw new GraphHttpError(res.status, await res.text());
    const json = (await res.json()) as {
      value?: { id: string; createdDateTime?: string; transcriptContentUrl?: string }[];
    };
    return (json.value ?? []).map((t) => ({
      id: t.id,
      onlineMeetingId,
      createdDateTime: t.createdDateTime,
      contentUrl: t.transcriptContentUrl,
    }));
  }

  async getTranscriptContent(ref: GraphTranscriptRef, graphUserId?: string): Promise<string> {
    const user = graphUserId ?? this.defaultUserId;
    const omId = ref.onlineMeetingId;
    if (!ref.contentUrl && !omId) {
      throw new Error("transcript content requires onlineMeetingId or contentUrl");
    }
    const path = ref.contentUrl
      ? undefined
      : `/users/${encodeURIComponent(user)}/onlineMeetings/${encodeURIComponent(omId!)}/transcripts/${encodeURIComponent(ref.id)}/content?$format=text/vtt`;
    const token = await this.tokens.getToken();
    const url = ref.contentUrl ?? `https://graph.microsoft.com/v1.0${path}`;
    const res = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${token}`, accept: "text/vtt" },
    });
    if (!res.ok) throw new GraphHttpError(res.status, await res.text());
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

function mapAttendanceRole(role?: string): ParticipantRole | undefined {
  const r = (role ?? "").toLowerCase();
  if (!r) return undefined;
  if (r.includes("organizer")) return "organizer";
  if (r.includes("presenter")) return "presenter";
  if (r.includes("attendee")) return "attendee";
  if (r.includes("guest")) return "guest";
  return "unknown";
}
