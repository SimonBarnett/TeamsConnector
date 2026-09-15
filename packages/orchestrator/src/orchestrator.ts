import {
  capabilitiesFor,
  ConnectorError,
  fail,
  meetingKey,
  newSessionId,
  newUtteranceId,
  nowIso,
  ok,
  redactJoinUrl,
  validateCancelSpeech,
  validateGetTranscript,
  validateJoinMeeting,
  validateLeave,
  validateMeta,
  validateRequestSummary,
  validateSpeak,
  validateStatus,
  type CallMeta,
  type CancelSpeechResponse,
  type Envelope,
  type GetMeetingStatusResponse,
  type GetTranscriptResponse,
  type JoinMeetingResponse,
  type LeaveMeetingResponse,
  type SessionRecord,
  type SpeakResponse,
  type Artifact,
} from "@teams-audio-join/shared";
import type { ConnectorStore } from "@teams-audio-join/store";
import type { GraphMeetingClient } from "@teams-audio-join/graph";
import { parseTranscriptContent } from "@teams-audio-join/graph";
import { summarise, type LlmClient } from "@teams-audio-join/summarizer";
import { classifyCaptions } from "./classify.ts";
import { makeEvent, type EventSink } from "./events.ts";
import { selectPlane } from "./plane.ts";
import { assertJoinConsent, assertJoinQuota } from "./policy.ts";

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const SUMMARY_CACHE_MS = 15_000;
const SUMMARY_MAX = 20;
const TRANSCRIPT_FINALISE_MS = 30_000;

export interface MediaWorker {
  healthy(): Promise<boolean>;
}

export class UnavailableMediaWorker implements MediaWorker {
  async healthy(): Promise<boolean> {
    return false;
  }
}

export interface OrchestratorOptions {
  store: ConnectorStore;
  graph: GraphMeetingClient;
  events: EventSink;
  llm: LlmClient;
  mediaWorker?: MediaWorker;
  assistantDisplayName?: string;
  wakePhrases?: string[];
}

export class Orchestrator {
  private readonly store: ConnectorStore;
  private readonly graph: GraphMeetingClient;
  private readonly events: EventSink;
  private readonly llm: LlmClient;
  private readonly mediaWorker: MediaWorker;
  private readonly assistantDisplayName: string;
  private readonly wakePhrases: string[];
  private readonly summaryMeta = new Map<string, { count: number; lastAt: number; last?: Artifact }>();

  constructor(opts: OrchestratorOptions) {
    this.store = opts.store;
    this.graph = opts.graph;
    this.events = opts.events;
    this.llm = opts.llm;
    this.mediaWorker = opts.mediaWorker ?? new UnavailableMediaWorker();
    this.assistantDisplayName = opts.assistantDisplayName ?? "Haitch (audio assistant)";
    this.wakePhrases = opts.wakePhrases ?? [];
  }

  async call(tool: string, args: unknown, rawMeta: unknown): Promise<Envelope<unknown>> {
    let meta: CallMeta;
    try {
      meta = validateMeta(rawMeta);
    } catch (err) {
      if (err instanceof ConnectorError) return fail(err);
      throw err;
    }
    try {
      const cached = await this.readIdempotent(tool, meta);
      if (cached) return cached;
      let result: Envelope<unknown>;
      switch (tool) {
        case "join_meeting":
          result = await this.joinMeeting(meta, args);
          break;
        case "get_meeting_status":
          result = await this.getMeetingStatus(meta, args);
          break;
        case "get_transcript":
          result = await this.getTranscript(meta, args);
          break;
        case "speak":
          result = await this.speak(meta, args);
          break;
        case "cancel_speech":
          result = await this.cancelSpeech(meta, args);
          break;
        case "request_summary":
          result = await this.requestSummary(meta, args);
          break;
        case "leave_meeting":
          result = await this.leaveMeeting(meta, args);
          break;
        default:
          throw new ConnectorError("invalid_argument", `Unknown tool ${tool}`, { field: "name" });
      }
      await this.writeIdempotent(tool, meta, result);
      return result;
    } catch (err) {
      if (err instanceof ConnectorError) return fail(err, meta.requestId);
      const wrapped = new ConnectorError("dependency_unavailable", err instanceof Error ? err.message : "unknown");
      return fail(wrapped, meta.requestId);
    }
  }

  async joinMeeting(meta: CallMeta, raw: unknown): Promise<Envelope<JoinMeetingResponse>> {
    const req = validateJoinMeeting(raw);
    await assertJoinConsent(this.store, meta, req);

    const key = meetingKey(req);
    const existing = await this.store.findLiveByMeeting(meta.tenantId, meta.userId, key);
    if (existing) {
      if (existing.mode === req.mode) {
        return ok(this.toJoinResponse(existing, true), meta.requestId);
      }
      throw new ConnectorError("conflict", "A live session exists for this meeting with a different mode.");
    }
    await assertJoinQuota(this.store, meta);

    const tenant = await this.store.getTenant(meta.tenantId);
    const plane = selectPlane(req, {
      mediaWorkerHealthy: await this.mediaWorker.healthy(),
      trackBConsented: Boolean(tenant?.trackBConsented),
    });

    const resolved = await this.graph.resolveMeeting({
      meetingUrl: req.meetingUrl,
      eventId: req.eventId,
      onlineMeetingId: req.onlineMeetingId,
    });
    if (!resolved) {
      throw new ConnectorError("meeting_not_found", "eventId/url/id did not resolve to an online meeting.");
    }
    if (resolved.joinUrlRedacted?.includes("?")) {
      resolved.joinUrlRedacted = redactJoinUrl(resolved.joinUrlRedacted);
    }

    const createdAt = nowIso();
    const sessionId = newSessionId();
    let session: SessionRecord = {
      sessionId,
      tenantId: meta.tenantId,
      userId: meta.userId,
      agentId: meta.agentId,
      state: "joining",
      plane,
      mode: req.mode,
      createdAt,
      startedAt: createdAt,
      meeting: resolved,
      meetingKey: key,
      locale: req.locale,
      announce: Boolean(req.announce && req.mode === "listen_speak" && plane === "media"),
      waitForAdmitSec: req.waitForAdmitSec ?? 60,
      capabilities: capabilitiesFor({ state: "joining", plane, mode: req.mode, stt: "none" }),
      participants: [],
      speak: { utterancesUsed: 0, utterancesMax: 6 },
    };
    await this.store.putSession(session);
    await this.audit(session, "join", "ok");
    await this.emitUpdated(session);

    session = await this.attachTranscript(session);
    return ok(this.toJoinResponse(session, false), meta.requestId);
  }

  async getMeetingStatus(meta: CallMeta, raw: unknown): Promise<Envelope<GetMeetingStatusResponse>> {
    const { sessionId } = validateStatus(raw);
    const session = await this.requireSession(sessionId, meta);
    const data: GetMeetingStatusResponse = {
      sessionId: session.sessionId,
      state: session.state,
      plane: session.plane,
      mode: session.mode,
      participants: session.participants,
      capabilities: session.capabilities,
      speak: session.speak,
    };
    if (session.startedAt) data.startedAt = session.startedAt;
    if (session.admittedAt) data.admittedAt = session.admittedAt;
    if (session.endedAt) data.endedAt = session.endedAt;
    if (session.lastError) data.lastError = session.lastError;
    return ok(data, meta.requestId);
  }

  async getTranscript(meta: CallMeta, raw: unknown): Promise<Envelope<GetTranscriptResponse>> {
    const req = validateGetTranscript(raw);
    const session = await this.requireSession(req.sessionId, meta);
    const sinceSeq = req.sinceSeq ?? 0;
    const segments = await this.store.listSegments(
      session.sessionId,
      sinceSeq,
      req.includePartials ?? true,
      req.limit ?? 200,
    );
    const max = segments.length ? Math.max(...segments.map((s) => s.seq)) : sinceSeq;
    const ended = session.state === "ended" || session.state === "failed";
    return ok(
      {
        sessionId: session.sessionId,
        segments,
        nextSeq: max,
        ended,
        canHear: session.capabilities.canHear,
      },
      meta.requestId,
    );
  }

  async speak(meta: CallMeta, raw: unknown): Promise<Envelope<SpeakResponse>> {
    const req = validateSpeak(raw);
    const session = await this.requireSession(req.sessionId, meta);
    const utteranceId = newUtteranceId();
    const allowed =
      session.mode === "listen_speak" &&
      session.plane === "media" &&
      session.state === "speaking_enabled" &&
      session.capabilities.canSpeak;
    if (!allowed) {
      const error = new ConnectorError(
        "mode_unsupported",
        "speak() is rejected when mode is listen or plane is transcript.",
      ).toBody();
      await this.events.emit(
        makeEvent({
          type: "speak.rejected",
          tenantId: session.tenantId,
          sessionId: session.sessionId,
          agentId: session.agentId,
          payload: { utteranceId, error },
        }),
      );
      return ok(
        {
          utteranceId,
          status: "rejected",
          reason: "mode_unsupported",
          error,
        },
        meta.requestId,
      );
    }
    return ok({ utteranceId, status: "queued" }, meta.requestId);
  }

  async cancelSpeech(meta: CallMeta, raw: unknown): Promise<Envelope<CancelSpeechResponse>> {
    const req = validateCancelSpeech(raw);
    await this.requireSession(req.sessionId, meta);
    return ok({ cancelled: [], status: "nothing_playing" }, meta.requestId);
  }

  async requestSummary(meta: CallMeta, raw: unknown): Promise<Envelope<Artifact>> {
    const req = validateRequestSummary(raw);
    const session = await this.requireSession(req.sessionId, meta);
    const style = req.style ?? "bullets";
    const bucket = this.summaryMeta.get(session.sessionId) ?? { count: 0, lastAt: 0 };
    if (bucket.count >= SUMMARY_MAX) {
      throw new ConnectorError("rate_limited", "Summary rate limit exceeded (20 / session).", {
        retryAfterMs: 60_000,
      });
    }
    if (!req.refresh && bucket.last && Date.now() - bucket.lastAt < SUMMARY_CACHE_MS) {
      return ok(bucket.last, meta.requestId);
    }
    const segments = await this.store.listSegments(session.sessionId, 0, false, 500);
    const artifact = await summarise({ session, segments, style, llm: this.llm });
    await this.store.putArtifact(artifact);
    session.lastArtifactId = artifact.artifactId;
    await this.store.putSession(session);
    this.summaryMeta.set(session.sessionId, {
      count: bucket.count + 1,
      lastAt: Date.now(),
      last: artifact,
    });
    return ok(artifact, meta.requestId);
  }

  async leaveMeeting(meta: CallMeta, raw: unknown): Promise<Envelope<LeaveMeetingResponse>> {
    const req = validateLeave(raw);
    const session = await this.requireSession(req.sessionId, meta);
    if (session.state === "ended" || session.state === "failed") {
      const data: LeaveMeetingResponse = {
        sessionId: session.sessionId,
        status: "already_ended",
        endedAt: session.endedAt ?? nowIso(),
      };
      if (session.lastArtifactId) data.artifactId = session.lastArtifactId;
      return ok(data, meta.requestId);
    }

    session.state = "leaving";
    await this.store.putSession(session);

    const segments = await this.store.listSegments(session.sessionId, 0, false, 500);
    const span =
      segments.length > 0
        ? Math.max(...segments.map((s) => s.endMs)) - Math.min(...segments.map((s) => s.tMs))
        : 0;
    let artifactId: string | undefined;
    if (span >= TRANSCRIPT_FINALISE_MS) {
      const artifact = await summarise({
        session: { ...session, state: "ended" },
        segments,
        style: "bullets",
        llm: this.llm,
      });
      await this.store.putArtifact(artifact);
      artifactId = artifact.artifactId;
      session.lastArtifactId = artifactId;
    }

    session.state = "ended";
    session.endedAt = nowIso();
    session.endedReason = req.reason === "error" ? "error" : "user_leave";
    session.capabilities = capabilitiesFor({
      state: "ended",
      plane: session.plane,
      mode: session.mode,
      stt: session.capabilities.stt,
    });
    await this.store.putSession(session);
    await this.audit(session, "leave", "ok");
    await this.events.emit(
      makeEvent({
        type: "session.ended",
        tenantId: session.tenantId,
        sessionId: session.sessionId,
        agentId: session.agentId,
        payload: { reason: session.endedReason, artifactId },
      }),
    );

    const data: LeaveMeetingResponse = {
      sessionId: session.sessionId,
      status: "left",
      endedAt: session.endedAt,
    };
    if (artifactId) data.artifactId = artifactId;
    return ok(data, meta.requestId);
  }

  private async attachTranscript(session: SessionRecord): Promise<SessionRecord> {
    if (session.plane !== "transcript") {
      session.state = "in_lobby";
      session.capabilities = capabilitiesFor({
        state: "in_lobby",
        plane: session.plane,
        mode: session.mode,
        stt: "none",
      });
      await this.store.putSession(session);
      await this.emitUpdated(session);
      return session;
    }

    const omId = session.meeting.onlineMeetingId;
    const participants = omId ? await this.graph.getParticipants(omId) : [];
    if (!participants.some((p) => p.isAssistant)) {
      participants.push({
        id: "assistant",
        displayName: this.assistantDisplayName,
        role: "assistant",
        inMeeting: true,
        isAssistant: true,
        joinedAt: nowIso(),
      });
    }
    session.participants = participants.slice(0, 250);

    const refs = omId ? await this.graph.listTranscripts(omId) : [];
    if (refs.length === 0) {
      session.state = "listening_deaf";
      session.admittedAt = nowIso();
      session.lastError = new ConnectorError(
        "stt_degraded",
        "Official transcription is off or not yet available.",
      ).toBody();
      session.capabilities = capabilitiesFor({
        state: "listening_deaf",
        plane: "transcript",
        mode: session.mode,
        stt: "none",
      });
      await this.store.putSession(session);
      await this.emitUpdated(session);
      return session;
    }

    const contents = await Promise.all(refs.map((r) => this.graph.getTranscriptContent(r)));
    const currentMax = await this.store.maxSeq(session.sessionId);
    const raw = contents.flatMap((c) => parseTranscriptContent(c, 0));
    const classified = classifyCaptions(
      raw.map((r) => ({ tMs: r.tMs, endMs: r.endMs, speaker: r.speaker, text: r.text })),
      currentMax,
      this.assistantDisplayName,
      this.wakePhrases,
    );
    if (classified.length) {
      await this.store.appendSegments(session.sessionId, classified);
      await this.events.emit(
        makeEvent({
          type: "transcript.delta",
          tenantId: session.tenantId,
          sessionId: session.sessionId,
          agentId: session.agentId,
          payload: { segments: classified.slice(0, 50) },
        }),
      );
      for (const seg of classified) {
        if (seg.addressedToAssistant) {
          await this.events.emit(
            makeEvent({
              type: "assistant.addressed",
              tenantId: session.tenantId,
              sessionId: session.sessionId,
              agentId: session.agentId,
              payload: { segment: seg, trigger: "name" },
            }),
          );
        }
      }
    }

    session.state = "listening";
    session.admittedAt = nowIso();
    session.capabilities = capabilitiesFor({
      state: "listening",
      plane: "transcript",
      mode: session.mode,
      stt: "official",
    });
    await this.store.putSession(session);
    await this.audit(session, "transcript_attach", "ok");
    await this.emitUpdated(session);
    return session;
  }

  private toJoinResponse(session: SessionRecord, resumed: boolean): JoinMeetingResponse {
    return {
      sessionId: session.sessionId,
      state: session.state,
      plane: session.plane,
      mode: session.mode,
      createdAt: session.createdAt,
      resumed,
      meeting: session.meeting,
      capabilities: session.capabilities,
    };
  }

  private async requireSession(sessionId: string, meta: CallMeta): Promise<SessionRecord> {
    const session = await this.store.getSession(sessionId);
    if (!session || session.tenantId !== meta.tenantId || session.userId !== meta.userId) {
      throw new ConnectorError("session_not_found", "Unknown or expired sessionId.");
    }
    return session;
  }

  private async emitUpdated(session: SessionRecord): Promise<void> {
    await this.events.emit(
      makeEvent({
        type: "session.updated",
        tenantId: session.tenantId,
        sessionId: session.sessionId,
        agentId: session.agentId,
        payload: {
          state: session.state,
          plane: session.plane,
          mode: session.mode,
          capabilities: session.capabilities,
          lastError: session.lastError,
        },
      }),
    );
  }

  private async audit(session: SessionRecord, action: string, result: string): Promise<void> {
    await this.store.appendAudit({
      ts: nowIso(),
      tenantId: session.tenantId,
      userId: session.userId,
      agentId: session.agentId,
      meetingId: session.meeting.onlineMeetingId ?? session.meetingKey,
      sessionId: session.sessionId,
      action,
      plane: session.plane,
      result,
    });
  }

  private principal(meta: CallMeta): string {
    return `${meta.tenantId}:${meta.userId}:${meta.agentId}`;
  }

  private async readIdempotent(tool: string, meta: CallMeta): Promise<Envelope<unknown> | undefined> {
    if (!meta.idempotencyKey) return undefined;
    const row = await this.store.getIdempotency(meta.idempotencyKey, tool, this.principal(meta));
    if (!row) return undefined;
    return JSON.parse(row.resultJson) as Envelope<unknown>;
  }

  private async writeIdempotent(tool: string, meta: CallMeta, result: Envelope<unknown>): Promise<void> {
    if (!meta.idempotencyKey) return;
    await this.store.putIdempotency({
      key: meta.idempotencyKey,
      tool,
      principal: this.principal(meta),
      createdAt: nowIso(),
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
      resultJson: JSON.stringify(result),
    });
  }
}
