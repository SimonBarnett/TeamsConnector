import { describe, expect, it } from "vitest";
import { InMemoryStore } from "@teams-audio-join/store";
import { FakeGraphClient, fixtureCatchup } from "@teams-audio-join/graph";
import { FixtureLlmClient } from "@teams-audio-join/summarizer";
import { looksLikeAudioBlobName } from "@teams-audio-join/shared";
import { MemoryEventSink } from "./events.ts";
import { LoopbackMediaWorker, Orchestrator } from "./orchestrator.ts";
import { seedReadyTenant, testMeta } from "./seed.ts";

const JOIN =
  "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=%7B%7D&pwd=SECRET99";

async function harness(graph = new FakeGraphClient([fixtureCatchup()])) {
  const store = new InMemoryStore();
  await seedReadyTenant(store);
  const events = new MemoryEventSink();
  const orch = new Orchestrator({
    store,
    graph,
    events,
    llm: new FixtureLlmClient({
      summary: "Ship Friday if QA is green.",
      decisions: ["Ship Friday if QA is green"],
      actions: [{ text: "Alex will send the deck", owner: "Alex", confidence: 0.8 }],
      openQuestions: [],
    }),
  });
  return { store, graph, events, orch };
}

describe("Orchestrator", () => {
  it("joins via Track A, redacts join secrets, and hears official captions", async () => {
    const { orch, events, store } = await harness();
    const joined = await orch.call(
      "join_meeting",
      { meetingUrl: JOIN, mode: "listen", plane: "auto" },
      testMeta(),
    );
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const data = joined.data as {
      sessionId: string;
      state: string;
      plane: string;
      capabilities: { canHear: boolean; canSpeak: boolean };
      meeting: { joinUrlRedacted?: string };
    };
    expect(data.plane).toBe("transcript");
    expect(data.state).toBe("listening");
    expect(data.capabilities.canHear).toBe(true);
    expect(data.capabilities.canSpeak).toBe(false);
    expect(data.meeting.joinUrlRedacted ?? "").not.toContain("pwd=");
    expect(data.meeting.joinUrlRedacted ?? "").not.toContain("SECRET99");

    const tx = await orch.call("get_transcript", { sessionId: data.sessionId }, testMeta());
    expect(tx.ok).toBe(true);
    if (!tx.ok) return;
    const segs = (tx.data as { segments: { text: string; speakerKind: string; addressedToAssistant?: boolean; redacted?: boolean }[] })
      .segments;
    expect(segs.some((s) => s.speakerKind === "human")).toBe(true);
    expect(segs.some((s) => s.speakerKind === "assistant")).toBe(true);
    expect(segs.some((s) => s.addressedToAssistant)).toBe(true);
    expect(segs.some((s) => s.redacted)).toBe(true);
    expect(segs.find((s) => s.redacted)?.text).not.toContain("not-a-real-token");

    expect(events.events.some((e) => e.type === "session.updated")).toBe(true);
    expect(events.events.some((e) => e.type === "transcript.delta")).toBe(true);
    expect(events.events.some((e) => e.type === "assistant.addressed")).toBe(true);

    const names = await store.storedObjectNames(data.sessionId);
    expect(names.some(looksLikeAudioBlobName)).toBe(false);
  });

  it("is idempotent for the same meeting+mode and conflicts on a mode change", async () => {
    const { orch } = await harness();
    const a = await orch.call("join_meeting", { meetingUrl: JOIN, mode: "listen" }, testMeta());
    const b = await orch.call("join_meeting", { meetingUrl: JOIN, mode: "listen" }, testMeta());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect((b.data as { resumed?: boolean }).resumed).toBe(true);
    expect((a.data as { sessionId: string }).sessionId).toBe((b.data as { sessionId: string }).sessionId);

    const c = await orch.call("join_meeting", { meetingUrl: JOIN, mode: "listen_speak" }, testMeta());
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.error.code).toBe("conflict");
  });

  it("returns listening_deaf when official transcription is off", async () => {
    const graph = new FakeGraphClient([fixtureCatchup()]);
    graph.transcriptionEnabled = false;
    const { orch } = await harness(graph);
    const joined = await orch.call("join_meeting", { eventId: "evt-priority", mode: "listen" }, testMeta());
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const data = joined.data as { state: string; capabilities: { canHear: boolean }; sessionId: string };
    expect(data.state).toBe("listening_deaf");
    expect(data.capabilities.canHear).toBe(false);

    const status = await orch.call("get_meeting_status", { sessionId: data.sessionId }, testMeta());
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect((status.data as { capabilities: { canHear: boolean } }).capabilities.canHear).toBe(false);
  });

  it("maps a calendar event without an online meeting to meeting_not_found", async () => {
    const { orch } = await harness();
    const res = await orch.call("join_meeting", { eventId: "no-such-event", mode: "listen" }, testMeta());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("meeting_not_found");
  });

  it("rejects speak on the transcript plane and leave is idempotent", async () => {
    const { orch, events } = await harness();
    const joined = await orch.call("join_meeting", { onlineMeetingId: "om-priority", mode: "listen" }, testMeta());
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const sessionId = (joined.data as { sessionId: string }).sessionId;

    const spoken = await orch.call("speak", { sessionId, text: "I will be two minutes late." }, testMeta());
    expect(spoken.ok).toBe(true);
    if (!spoken.ok) return;
    expect((spoken.data as { status: string }).status).toBe("rejected");
    expect((spoken.data as { error?: { code: string } }).error?.code).toBe("mode_unsupported");

    const left = await orch.call("leave_meeting", { sessionId }, testMeta());
    expect(left.ok).toBe(true);
    const left2 = await orch.call("leave_meeting", { sessionId }, testMeta());
    expect(left2.ok).toBe(true);
    if (!left2.ok) return;
    expect((left2.data as { status: string }).status).toBe("already_ended");
    expect(events.events.some((e) => e.type === "session.ended")).toBe(true);
  });

  it("does not invent a summary when the session is deaf", async () => {
    const graph = new FakeGraphClient([fixtureCatchup()]);
    graph.transcriptionEnabled = false;
    const { orch } = await harness(graph);
    const joined = await orch.call("join_meeting", { onlineMeetingId: "om-priority", mode: "listen" }, testMeta());
    if (!joined.ok) return;
    const sessionId = (joined.data as { sessionId: string }).sessionId;
    const sum = await orch.call("request_summary", { sessionId, style: "bullets" }, testMeta());
    expect(sum.ok).toBe(true);
    if (!sum.ok) return;
    const artifact = sum.data as { summary: string; decisions: string[] };
    expect(artifact.summary.toLowerCase()).toMatch(/did not hear|no audio|not available/);
    expect(artifact.decisions).toEqual([]);
  });

  it("requires consent before joining", async () => {
    const store = new InMemoryStore();
    const orch = new Orchestrator({
      store,
      graph: new FakeGraphClient([fixtureCatchup()]),
      events: new MemoryEventSink(),
      llm: new FixtureLlmClient({ summary: "x" }),
    });
    const res = await orch.call("join_meeting", { meetingUrl: JOIN, mode: "listen" }, testMeta());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("unauthenticated");
  });

  it("does not attach avatar on Track A when media is unavailable", async () => {
    const { orch } = await harness();
    const res = await orch.call(
      "join_meeting",
      { onlineMeetingId: "om-priority", mode: "listen", avatar: true },
      testMeta(),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(["plane_unavailable", "media_permission_denied"]).toContain(res.error.code);
  });

  it("sends a still avatar on the media plane without enabling speak", async () => {
    const store = new InMemoryStore();
    await seedReadyTenant(store, { trackB: true });
    const events = new MemoryEventSink();
    const orch = new Orchestrator({
      store,
      graph: new FakeGraphClient([fixtureCatchup()]),
      events,
      llm: new FixtureLlmClient({ summary: "x" }),
      mediaWorker: new LoopbackMediaWorker(),
    });
    const joined = await orch.call(
      "join_meeting",
      { onlineMeetingId: "om-priority", mode: "listen", avatar: true, plane: "auto" },
      testMeta(),
    );
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const data = joined.data as {
      plane: string;
      mode: string;
      sessionId: string;
      capabilities: { canSpeak: boolean; canShowVideo: boolean };
    };
    expect(data.plane).toBe("media");
    expect(data.mode).toBe("listen");
    expect(data.capabilities.canSpeak).toBe(false);
    expect(data.capabilities.canShowVideo).toBe(true);

    const status = await orch.call("get_meeting_status", { sessionId: data.sessionId }, testMeta());
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    const video = (status.data as { video?: { sending: boolean; source: string; width?: number } }).video;
    expect(video?.sending).toBe(true);
    expect(video?.source).toBe("still_avatar");
    expect(video?.width).toBe(640);
  });

  async function speakHarness() {
    const store = new InMemoryStore();
    await seedReadyTenant(store, { trackB: true });
    const events = new MemoryEventSink();
    const worker = new LoopbackMediaWorker();
    const orch = new Orchestrator({
      store,
      graph: new FakeGraphClient([fixtureCatchup()]),
      events,
      llm: new FixtureLlmClient({ summary: "x" }),
      mediaWorker: worker,
      speakCooldownMs: 0,
    });
    const joined = await orch.call(
      "join_meeting",
      { onlineMeetingId: "om-priority", mode: "listen_speak", plane: "auto" },
      testMeta(),
    );
    expect(joined.ok).toBe(true);
    if (!joined.ok) throw new Error("join failed");
    const data = joined.data as { sessionId: string; state: string; capabilities: { canSpeak: boolean } };
    expect(data.state).toBe("speaking_enabled");
    expect(data.capabilities.canSpeak).toBe(true);
    return { orch, events, worker, sessionId: data.sessionId, store };
  }

  it("plays speak() on listen_speak media and records an assistant echo segment", async () => {
    const { orch, sessionId, store } = await speakHarness();
    const spoken = await orch.call(
      "speak",
      { sessionId, text: "I will capture the actions." },
      testMeta(),
    );
    expect(spoken.ok).toBe(true);
    if (!spoken.ok) return;
    const data = spoken.data as { status: string; utteranceId: string };
    expect(data.status).toBe("playing");
    const segs = await store.listSegments(sessionId, 0, true, 50);
    expect(segs.some((s) => s.speakerKind === "assistant" && s.linkedUtteranceId === data.utteranceId)).toBe(true);
  });

  it("rejects secrets and SSML, and caps a seventh utterance", async () => {
    const { orch, sessionId } = await speakHarness();
    const secret = await orch.call(
      "speak",
      { sessionId, text: "The token is Bearer abcdefghijklmnop" },
      testMeta(),
    );
    expect(secret.ok).toBe(true);
    if (!secret.ok) return;
    expect((secret.data as { status: string; error?: { code: string } }).status).toBe("rejected");
    expect((secret.data as { error?: { code: string } }).error?.code).toBe("content_filtered");

    for (let i = 0; i < 6; i++) {
      const r = await orch.call("speak", { sessionId, text: `Update number ${i} is done.` }, testMeta());
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect((r.data as { status: string }).status).toBe("playing");
      await orch.call("cancel_speech", { sessionId }, testMeta());
    }
    const seventh = await orch.call("speak", { sessionId, text: "This should be capped." }, testMeta());
    expect(seventh.ok).toBe(true);
    if (!seventh.ok) return;
    expect((seventh.data as { error?: { code: string } }).error?.code).toBe("speak_capped");
  });

  it("barges in on human speech within 400 ms and ejects with socket close under 2s", async () => {
    const { orch, sessionId, events } = await speakHarness();
    const spoken = await orch.call("speak", { sessionId, text: "Please hold while I read the actions." }, testMeta());
    expect(spoken.ok).toBe(true);
    const barge = await orch.handleHumanSpeech(sessionId, 300);
    expect(barge.cancelled.length).toBe(1);
    expect(barge.stopLatencyMs).toBeLessThanOrEqual(400);
    expect(events.events.some((e) => e.type === "speak.finished")).toBe(true);

    const eject = await orch.handleRemoteEnd(sessionId, "ejected");
    expect(eject.closeLatencyMs).toBeLessThanOrEqual(2000);
    const status = await orch.call("get_meeting_status", { sessionId }, testMeta());
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect((status.data as { state: string }).state).toBe("ended");
  });
});
