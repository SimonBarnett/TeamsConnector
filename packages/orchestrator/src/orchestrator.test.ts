import { describe, expect, it } from "vitest";
import { InMemoryStore } from "@teams-audio-join/store";
import { FakeGraphClient, fixtureCatchup } from "@teams-audio-join/graph";
import { FixtureLlmClient } from "@teams-audio-join/summarizer";
import { looksLikeAudioBlobName } from "@teams-audio-join/shared";
import { MemoryEventSink } from "./events.ts";
import { Orchestrator } from "./orchestrator.ts";
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
});
