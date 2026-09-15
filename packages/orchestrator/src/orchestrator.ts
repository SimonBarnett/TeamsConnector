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
  speakBlockedReason,
  validateCancelSpeech,
  validateGetTranscript,
  validateJoinMeeting,
  validateDeleteRoutine,
  validateLeave,
  validateMeta,
  validatePrepareHoursDraft,
  validateRequestSummary,
  validateSpeak,
  validateStatus,
  validateUpsertRoutine,
  newRoutineId,
  findMatchingRoutine,
  type CallMeta,
  type HoursDraft,
  type CancelSpeechResponse,
  type Envelope,
  type GetMeetingStatusResponse,
  type GetTranscriptResponse,
  type JoinMeetingResponse,
  type LeaveMeetingResponse,
  type SessionRecord,
  type SpeakResponse,
  type Artifact,
  type EndedReason,
  type TranscriptSegment,
} from "@teams-audio-join/shared";
import type { ConnectorStore } from "@teams-audio-join/store";
import type { GraphMeetingClient } from "@teams-audio-join/graph";
import { parseTranscriptContent } from "@teams-audio-join/graph";
import { hoursHintFor, summarise, type LlmClient } from "@teams-audio-join/summarizer";
import { classifyCaptions } from "./classify.ts";
import { matchEcho, type PlayedUtterance } from "./echo.ts";
import { makeEvent, type EventSink } from "./events.ts";
import { LoopbackMediaWorker, UnavailableMediaWorker, type MediaWorker } from "./media-loopback.ts";
import { selectPlane } from "./plane.ts";
import { assertAck, assertBound, assertJoinConsent, assertJoinQuota } from "./policy.ts";
import { announceText, EstimatedTts, type TtsEngine } from "./tts.ts";

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const SUMMARY_CACHE_MS = 15_000;
const SUMMARY_MAX = 20;
const TRANSCRIPT_FINALISE_MS = 30_000;
const SPEAK_MAX = 6;
const SPEAK_COOLDOWN_MS = 15_000;
const BARGE_IN_MS = 250;

export type { MediaWorker };
export { LoopbackMediaWorker, UnavailableMediaWorker };

interface SpeakRuntime {
  used: number;
  cooldownEndsAt: number;
  playing?: { utteranceId: string; text: string; priority: "normal" | "urgent"; allowBargeIn: boolean };
  queued?: { utteranceId: string; text: string; priority: "normal" | "urgent"; allowBargeIn: boolean; durationMs: number };
  played: PlayedUtterance[];
}

export interface OrchestratorOptions {
  store: ConnectorStore;
  graph: GraphMeetingClient;
  events: EventSink;
  llm: LlmClient;
  mediaWorker?: MediaWorker;
  tts?: TtsEngine;
  assistantDisplayName?: string;
  wakePhrases?: string[];
  speakCooldownMs?: number;
}

export class Orchestrator {
  private readonly store: ConnectorStore;
  private readonly graph: GraphMeetingClient;
  private readonly events: EventSink;
  private readonly llm: LlmClient;
  private readonly mediaWorker: MediaWorker;
  private readonly tts: TtsEngine;
  private readonly assistantDisplayName: string;
  private readonly wakePhrases: string[];
  private readonly speakCooldownMs: number;
  private readonly summaryMeta = new Map<string, { count: number; lastAt: number; last?: Artifact }>();
  private readonly speakRt = new Map<string, SpeakRuntime>();

  constructor(opts: OrchestratorOptions) {
    this.store = opts.store;
    this.graph = opts.graph;
    this.events = opts.events;
    this.llm = opts.llm;
    this.mediaWorker = opts.mediaWorker ?? new UnavailableMediaWorker();
    this.tts = opts.tts ?? new EstimatedTts();
    this.assistantDisplayName = opts.assistantDisplayName ?? "Haitch (audio assistant)";
    this.wakePhrases = opts.wakePhrases ?? [];
    this.speakCooldownMs = opts.speakCooldownMs ?? SPEAK_COOLDOWN_MS;
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
        case "upsert_standing_routine":
          result = await this.upsertStandingRoutine(meta, args);
          break;
        case "list_standing_routines":
          result = await this.listStandingRoutines(meta, args);
          break;
        case "delete_standing_routine":
          result = await this.deleteStandingRoutine(meta, args);
          break;
        case "prepare_hours_draft":
          result = await this.prepareHoursDraft(meta, args);
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
    await assertBound(this.store, meta);
    await assertAck(this.store, meta);

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
    await assertJoinConsent(this.store, meta, req, resolved);
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
      avatar: Boolean(req.avatar && plane === "media"),
      capabilities: capabilitiesFor({
        state: "joining",
        plane,
        mode: req.mode,
        stt: "none",
        avatar: Boolean(req.avatar && plane === "media"),
      }),
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
    if (session.video) data.video = session.video;
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
    const reject = async (code: ConnectorError["code"], message: string, extra?: Record<string, unknown>) => {
      const error = new ConnectorError(code, message, extra).toBody();
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
        { utteranceId, status: "rejected" as const, reason: code, error },
        meta.requestId,
      );
    };

    const allowed =
      session.mode === "listen_speak" &&
      session.plane === "media" &&
      session.state === "speaking_enabled" &&
      session.capabilities.canSpeak;
    if (!allowed) {
      return reject("mode_unsupported", "speak() is rejected when mode is listen or plane is transcript.");
    }

    const blocked = speakBlockedReason(req.text);
    if (blocked) {
      return reject("content_filtered", blocked);
    }

    const rt = this.runtime(session.sessionId);
    if (rt.used >= SPEAK_MAX) {
      return reject("speak_capped", "Six played utterances per session.", { retryAfterMs: SPEAK_COOLDOWN_MS });
    }
    if (Date.now() < rt.cooldownEndsAt) {
      return reject("speak_capped", "15s cooldown after play start.", {
        retryAfterMs: Math.max(0, rt.cooldownEndsAt - Date.now()),
      });
    }

    const { durationMs } = await this.tts.synthesize(req.text, req.voice ?? "assistant_default");
    const priority = req.priority ?? "normal";
    const allowBargeIn = req.allowBargeIn ?? true;

    if (rt.playing && priority !== "urgent") {
      return reject("speak_capped", "Queue depth is 1; wait for the current utterance.", {
        retryAfterMs: durationMs,
      });
    }
    if (rt.playing && priority === "urgent" && rt.playing.priority !== "urgent") {
      await this.mediaWorker.cancel(session.sessionId);
      rt.playing = undefined;
    }
    if (rt.playing?.priority === "urgent" && priority === "urgent") {
      rt.queued = { utteranceId, text: req.text, priority, allowBargeIn, durationMs };
      return ok({ utteranceId, status: "queued", estimatedDurationMs: durationMs }, meta.requestId);
    }

    try {
      const played = await this.mediaWorker.play(session.sessionId, {
        utteranceId,
        text: req.text,
        durationMs,
        allowBargeIn,
        priority,
      });
      if (played.status === "queued") {
        rt.queued = { utteranceId, text: req.text, priority, allowBargeIn, durationMs };
        return ok({ utteranceId, status: "queued", estimatedDurationMs: durationMs }, meta.requestId);
      }
    } catch {
      return reject("speak_rejected", "Media worker refused the utterance.");
    }

    await this.markPlaying(session, utteranceId, req.text, priority, allowBargeIn, durationMs);
    return ok({ utteranceId, status: "playing", estimatedDurationMs: durationMs }, meta.requestId);
  }

  async cancelSpeech(meta: CallMeta, raw: unknown): Promise<Envelope<CancelSpeechResponse>> {
    const req = validateCancelSpeech(raw);
    const session = await this.requireSession(req.sessionId, meta);
    const result = await this.mediaWorker.cancel(session.sessionId, req.utteranceId);
    const rt = this.runtime(session.sessionId);
    if (result.cancelled.length) {
      rt.playing = undefined;
      rt.queued = undefined;
      await this.emitSpeakFinished(session, result.cancelled[0]!, "cancelled", 0);
    }
    return ok(
      {
        cancelled: result.cancelled,
        status: result.cancelled.length ? "cancelled" : "nothing_playing",
      },
      meta.requestId,
    );
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
    await this.mediaWorker.leave(session.sessionId);

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
      await this.emitWorkflowOnEnd(session, artifact);
    }

    session.state = "ended";
    session.endedAt = nowIso();
    session.endedReason = req.reason === "error" ? "error" : "user_leave";
    session.video = session.avatar
      ? { sending: false, source: "none" }
      : session.video;
    session.capabilities = capabilitiesFor({
      state: "ended",
      plane: session.plane,
      mode: session.mode,
      stt: session.capabilities.stt,
      avatar: session.avatar,
      videoSending: false,
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

  async upsertStandingRoutine(meta: CallMeta, raw: unknown): Promise<Envelope<unknown>> {
    await assertBound(this.store, meta);
    await assertAck(this.store, meta);
    if (!meta.confirmStanding && !meta.meetingConfirmed) {
      throw new ConnectorError(
        "consent_required",
        "Creating a standing routine requires confirmStanding or meetingConfirmed.",
      );
    }
    const body = validateUpsertRoutine(raw);
    const routineId = body.routineId ?? newRoutineId();
    if (body.routineId) {
      const existing = await this.store.getRoutine(body.routineId);
      if (existing && (existing.tenantId !== meta.tenantId || existing.userId !== meta.userId)) {
        throw new ConnectorError("session_not_found", "Unknown routineId.");
      }
    }
    const row = {
      routineId,
      tenantId: meta.tenantId,
      userId: meta.userId,
      label: body.label,
      enabled: body.enabled,
      mode: "listen" as const,
      plane: body.plane,
      avatar: body.avatar,
      match: body.match,
      hoursDraft: body.hoursDraft,
      ownerMemo: body.ownerMemo,
      createdAt: nowIso(),
    };
    await this.store.putRoutine(row);
    return ok(row, meta.requestId);
  }

  async listStandingRoutines(meta: CallMeta, _raw: unknown): Promise<Envelope<unknown>> {
    await assertBound(this.store, meta);
    const routines = await this.store.listRoutines(meta.tenantId, meta.userId);
    return ok({ routines }, meta.requestId);
  }

  async deleteStandingRoutine(meta: CallMeta, raw: unknown): Promise<Envelope<unknown>> {
    await assertBound(this.store, meta);
    const { routineId } = validateDeleteRoutine(raw);
    const okDel = await this.store.deleteRoutine(meta.tenantId, meta.userId, routineId);
    if (!okDel) throw new ConnectorError("session_not_found", "Unknown routineId.");
    return ok({ deleted: true, routineId }, meta.requestId);
  }

  async prepareHoursDraft(meta: CallMeta, raw: unknown): Promise<Envelope<HoursDraft>> {
    const { sessionId } = validatePrepareHoursDraft(raw);
    const session = await this.requireSession(sessionId, meta);
    const draft = await this.buildHoursDraft(session);
    await this.events.emit(
      makeEvent({
        type: "hours.draft_ready",
        tenantId: session.tenantId,
        sessionId: session.sessionId,
        agentId: session.agentId,
        payload: { draft },
      }),
    );
    return ok(draft, meta.requestId);
  }

  private async attachTranscript(session: SessionRecord): Promise<SessionRecord> {
    if (session.plane !== "transcript") {
      session.state = "in_lobby";
      const admitted = await this.mediaWorker.admit(session.sessionId, {
        avatar: session.avatar,
        speak: session.mode === "listen_speak",
      });
      session.admittedAt = nowIso();
      if (session.avatar && admitted.videoSending) {
        session.video = { sending: true, source: "still_avatar", width: 640, height: 360 };
      }
      if (session.mode === "listen_speak") {
        session.state = "speaking_enabled";
      } else {
        session.state = admitted.canHear ? "listening" : "listening_deaf";
      }
      session.capabilities = capabilitiesFor({
        state: session.state,
        plane: session.plane,
        mode: session.mode,
        stt: admitted.canHear ? "live" : "none",
        avatar: session.avatar,
        videoSending: session.video?.sending,
      });
      await this.store.putSession(session);
      await this.emitUpdated(session);
      if (session.announce && session.state === "speaking_enabled") {
        await this.playAnnounce(session);
      }
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
      this.runtime(session.sessionId).played,
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

  /** Graph/media callback: human speech ≥ 250 ms barges in on normal TTS. */
  async handleHumanSpeech(sessionId: string, durationMs: number): Promise<{ cancelled: string[]; stopLatencyMs: number }> {
    if (durationMs < BARGE_IN_MS) return { cancelled: [], stopLatencyMs: 0 };
    const result = await this.mediaWorker.bargeIn(sessionId);
    const rt = this.runtime(sessionId);
    if (result.cancelled.length) {
      rt.playing = undefined;
      const session = await this.store.getSession(sessionId);
      if (session) {
        await this.emitSpeakFinished(session, result.cancelled[0]!, "cancelled", result.stopLatencyMs);
      }
    }
    return result;
  }

  /** Organizer mute: cancel TTS, keep the session, canSpeak=false. */
  async handleMuted(sessionId: string): Promise<void> {
    const session = await this.store.getSession(sessionId);
    if (!session) return;
    await this.mediaWorker.mute(sessionId);
    const rt = this.runtime(sessionId);
    rt.playing = undefined;
    rt.queued = undefined;
    session.state = session.plane === "media" ? "listening" : session.state;
    session.capabilities = capabilitiesFor({
      state: session.state,
      plane: session.plane,
      mode: "listen",
      stt: session.capabilities.stt,
      avatar: session.avatar,
      videoSending: session.video?.sending,
    });
    session.mode = "listen";
    await this.store.putSession(session);
    await this.emitUpdated(session);
  }

  /** Organizer eject or meeting ended. Closes media sockets then finalises. */
  async handleRemoteEnd(sessionId: string, reason: Extract<EndedReason, "ejected" | "meeting_ended">): Promise<{ closeLatencyMs: number }> {
    const left = await this.mediaWorker.leave(sessionId);
    const session = await this.store.getSession(sessionId);
    if (!session || session.state === "ended" || session.state === "failed") return left;
    session.state = "ended";
    session.endedAt = nowIso();
    session.endedReason = reason;
    session.capabilities = capabilitiesFor({
      state: "ended",
      plane: session.plane,
      mode: session.mode,
      stt: session.capabilities.stt,
      avatar: session.avatar,
      videoSending: false,
    });
    await this.store.putSession(session);
    await this.events.emit(
      makeEvent({
        type: "session.ended",
        tenantId: session.tenantId,
        sessionId,
        agentId: session.agentId,
        payload: { reason },
      }),
    );
    return left;
  }

  private runtime(sessionId: string): SpeakRuntime {
    let rt = this.speakRt.get(sessionId);
    if (!rt) {
      rt = { used: 0, cooldownEndsAt: 0, played: [] };
      this.speakRt.set(sessionId, rt);
    }
    return rt;
  }

  private async markPlaying(
    session: SessionRecord,
    utteranceId: string,
    text: string,
    priority: "normal" | "urgent",
    allowBargeIn: boolean,
    durationMs: number,
  ): Promise<void> {
    const rt = this.runtime(session.sessionId);
    rt.playing = { utteranceId, text, priority, allowBargeIn };
    rt.used += 1;
    rt.cooldownEndsAt = Date.now() + this.speakCooldownMs;
    rt.played.push({ utteranceId, text });
    session.speak = {
      utterancesUsed: rt.used,
      utterancesMax: SPEAK_MAX,
      cooldownEndsAt: new Date(rt.cooldownEndsAt).toISOString(),
    };
    await this.store.putSession(session);
    await this.appendSyntheticEcho(session, utteranceId, text, durationMs);
  }

  private async playAnnounce(session: SessionRecord): Promise<void> {
    const text = announceText(this.assistantDisplayName);
    if (speakBlockedReason(text)) return;
    const utteranceId = newUtteranceId();
    const { durationMs } = await this.tts.synthesize(text, "assistant_brief");
    try {
      await this.mediaWorker.play(session.sessionId, {
        utteranceId,
        text,
        durationMs,
        allowBargeIn: true,
        priority: "normal",
      });
      await this.markPlaying(session, utteranceId, text, "normal", true, durationMs);
    } catch {
      /* announce is best-effort */
    }
  }

  private async emitSpeakFinished(
    session: SessionRecord,
    utteranceId: string,
    status: "played" | "cancelled",
    durationMs: number,
  ): Promise<void> {
    await this.events.emit(
      makeEvent({
        type: "speak.finished",
        tenantId: session.tenantId,
        sessionId: session.sessionId,
        agentId: session.agentId,
        payload: { utteranceId, status, durationMs },
      }),
    );
  }

  private async emitWorkflowOnEnd(session: SessionRecord, artifact: Artifact): Promise<void> {
    await this.events.emit(
      makeEvent({
        type: "artifact.ready",
        tenantId: session.tenantId,
        sessionId: session.sessionId,
        agentId: session.agentId,
        payload: { artifact },
      }),
    );
    const routines = await this.store.listRoutines(session.tenantId, session.userId);
    const hit = findMatchingRoutine(routines, {
      eventId: session.meeting.eventId,
      subject: session.meeting.subject,
      startAt: session.meeting.startAt,
    });
    if (hit?.hoursDraft) {
      try {
        const draft = await this.buildHoursDraft({ ...session, lastArtifactId: artifact.artifactId });
        await this.events.emit(
          makeEvent({
            type: "hours.draft_ready",
            tenantId: session.tenantId,
            sessionId: session.sessionId,
            agentId: session.agentId,
            payload: { draft },
          }),
        );
      } catch {
        /* no duration — skip rather than invent hours */
      }
    }
    if (hit?.ownerMemo) {
      await this.events.emit(
        makeEvent({
          type: "owner.memo",
          tenantId: session.tenantId,
          sessionId: session.sessionId,
          agentId: session.agentId,
          payload: { sessionId: session.sessionId, artifactId: artifact.artifactId, text: artifact.summary },
        }),
      );
    }
  }

  private async buildHoursDraft(session: SessionRecord): Promise<HoursDraft> {
    const ended = { ...session, state: "ended" as const, endedAt: session.endedAt ?? nowIso() };
    const segments = await this.store.listSegments(session.sessionId, 0, false, 500);
    const artifact = await summarise({ session: ended, segments, style: "hours", llm: this.llm });
    await this.store.putArtifact(artifact);
    const hint = artifact.hoursHint ?? hoursHintFor(ended);
    if (!hint) {
      throw new ConnectorError("invalid_argument", "No meeting duration to draft hours from. Do not invent hours from the title.");
    }
    return {
      source: "teams-audio-join",
      artifactId: artifact.artifactId,
      sessionId: session.sessionId,
      hours: hint.hours,
      label: hint.label,
      requiresHumanConfirm: true,
      billableSuggested: false,
    };
  }

  private async appendSyntheticEcho(
    session: SessionRecord,
    utteranceId: string,
    text: string,
    durationMs: number,
  ): Promise<void> {
    const seq = (await this.store.maxSeq(session.sessionId)) + 1;
    const seg: TranscriptSegment = {
      seq,
      tMs: 0,
      endMs: durationMs,
      speaker: this.assistantDisplayName,
      speakerKind: "assistant",
      text,
      isPartial: false,
      source: "agent_tts_echo",
      linkedUtteranceId: utteranceId,
    };
    await this.store.appendSegments(session.sessionId, [seg]);
  }
}
