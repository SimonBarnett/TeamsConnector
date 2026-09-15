import { describe, expect, it } from "vitest";
import { nowIso, type SessionRecord, type TranscriptSegment } from "@teams-audio-join/shared";
import { FixtureLlmClient, humanFinals, summarise } from "./grounded.ts";

function session(): SessionRecord {
  return {
    sessionId: "ses_01K7Q3N8R2M0K7V1C4D8E2F6GH",
    tenantId: "11111111-2222-3333-4444-555555555555",
    userId: "user-1",
    agentId: "haitch",
    state: "ended",
    plane: "transcript",
    mode: "listen",
    createdAt: nowIso(),
    admittedAt: "2026-09-15T12:00:00.000Z",
    endedAt: "2026-09-15T13:00:00.000Z",
    meeting: { subject: "Priority wider catchup" },
    meetingKey: "om:x",
    announce: false,
    waitForAdmitSec: 60,
    avatar: false,
    capabilities: { canHear: true, canSpeak: false, stt: "official", canShowVideo: false },
    participants: [],
    speak: {},
  };
}

const segments: TranscriptSegment[] = [
  {
    seq: 1,
    tMs: 1000,
    endMs: 4000,
    speaker: "Simon Barnett",
    speakerKind: "human",
    text: "We should ship Friday if QA is green.",
    isPartial: false,
    source: "teams_official",
  },
  {
    seq: 2,
    tMs: 5000,
    endMs: 8000,
    speaker: "Haitch (audio assistant)",
    speakerKind: "assistant",
    text: "Noted, I will capture actions.",
    isPartial: false,
    source: "agent_tts_echo",
  },
  {
    seq: 3,
    tMs: 9000,
    endMs: 12000,
    speaker: "Simon Barnett",
    speakerKind: "human",
    text: "Action: Alex will send the deck.",
    isPartial: false,
    source: "teams_official",
  },
];

describe("summariser", () => {
  it("excludes assistant echo from the grounded window", () => {
    const humans = humanFinals(segments);
    expect(humans.every((s) => s.speakerKind === "human")).toBe(true);
    expect(humans).toHaveLength(2);
  });

  it("does not fabricate a narrative when there are no human finals", async () => {
    const art = await summarise({
      session: session(),
      segments: [segments[1]!],
      style: "bullets",
      llm: new FixtureLlmClient({ summary: "Should never be used" }),
    });
    expect(art.summary.toLowerCase()).toContain("did not hear");
    expect(art.decisions).toEqual([]);
    expect(art.groundedSeqRange).toEqual({ from: 0, to: 0 });
  });

  it("records groundedSeqRange from human finals and hoursHint for hours style", async () => {
    const art = await summarise({
      session: session(),
      segments,
      style: "hours",
      llm: new FixtureLlmClient({
        summary: "Ship Friday if QA is green.",
        decisions: ["Ship Friday if QA is green"],
        actions: [{ text: "Alex will send the deck", owner: "Alex", confidence: 0.8 }],
        openQuestions: ["Is QA green?"],
      }),
    });
    expect(art.groundedSeqRange).toEqual({ from: 1, to: 3 });
    expect(art.hoursHint?.billableSuggested).toBe(false);
    expect(art.hoursHint?.hours).toBe(1);
    expect(art.summary).toContain("Ship Friday");
  });
});
