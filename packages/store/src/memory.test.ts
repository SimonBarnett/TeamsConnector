import { describe, expect, it } from "vitest";
import { looksLikeAudioBlobName, newSessionId, nowIso, type SessionRecord } from "@teams-audio-join/shared";
import { EnvelopeCipher } from "./crypto.ts";
import { InMemoryStore } from "./memory.ts";

function session(id: string): SessionRecord {
  return {
    sessionId: id,
    tenantId: "11111111-2222-3333-4444-555555555555",
    userId: "user-1",
    agentId: "haitch",
    state: "listening",
    plane: "transcript",
    mode: "listen",
    createdAt: nowIso(),
    meeting: { subject: "Priority wider catchup", joinUrlRedacted: "https://teams.microsoft.com/l/meetup-join/19%3ameeting" },
    meetingKey: "om:abc",
    announce: false,
    waitForAdmitSec: 60,
    avatar: false,
    capabilities: { canHear: true, canSpeak: false, stt: "official", canShowVideo: false },
    participants: [],
    speak: { utterancesUsed: 0, utterancesMax: 6 },
  };
}

describe("InMemoryStore", () => {
  it("encrypts segment text at rest and never stores audio blobs", async () => {
    const store = new InMemoryStore(new EnvelopeCipher(Buffer.alloc(32, 3)));
    const id = newSessionId();
    await store.putSession(session(id));
    await store.appendSegments(id, [
      {
        seq: 1,
        tMs: 0,
        endMs: 1200,
        speaker: "Simon Barnett",
        speakerKind: "human",
        text: "Let's ship Friday",
        isPartial: false,
        source: "teams_official",
      },
    ]);
    const listed = await store.listSegments(id, 0, true, 10);
    expect(listed[0]?.text).toBe("Let's ship Friday");
    const names = await store.storedObjectNames(id);
    expect(names.some(looksLikeAudioBlobName)).toBe(false);
    expect(names).toEqual([]);
  });

  it("does not persist join-url query strings in audit", async () => {
    const store = new InMemoryStore();
    await store.appendAudit({
      ts: nowIso(),
      tenantId: "11111111-2222-3333-4444-555555555555",
      userId: "user-1",
      agentId: "haitch",
      sessionId: "ses_01K7Q3N8R2M0K7V1C4D8E2F6GH",
      action: "join",
      plane: "transcript",
      result: "ok",
      detail: "https://teams.microsoft.com/l/meetup-join/19%3ameeting",
    });
    const rows = await store.listAudit("ses_01K7Q3N8R2M0K7V1C4D8E2F6GH");
    expect(rows[0]?.detail ?? "").not.toContain("pwd=");
  });

  it("TTL sweep deletes segments and artifacts but not audit", async () => {
    const store = new InMemoryStore();
    const id = newSessionId();
    await store.putSession(session(id));
    await store.appendSegments(id, [
      {
        seq: 1,
        tMs: 0,
        endMs: 1000,
        speaker: "Simon",
        speakerKind: "human",
        text: "hello",
        isPartial: false,
        source: "teams_official",
      },
    ]);
    await store.putArtifact({
      artifactId: "art_01K7Q3N8R2M0K7V1C4D8E2F6GH",
      sessionId: id,
      style: "bullets",
      partial: false,
      createdAt: new Date(Date.now() - 20 * 86400_000).toISOString(),
      summary: "x",
      decisions: [],
      actions: [],
      openQuestions: [],
      groundedSeqRange: { from: 1, to: 1 },
    });
    await store.appendAudit({
      ts: nowIso(),
      tenantId: "11111111-2222-3333-4444-555555555555",
      userId: "user-1",
      agentId: "haitch",
      sessionId: id,
      action: "join",
      result: "ok",
    });
    const swept = await store.sweepExpired(Date.now() + 15 * 86400_000, 14 * 86400_000);
    expect(swept.segments).toBe(1);
    expect(swept.artifacts).toBe(1);
    expect((await store.listAudit(id)).length).toBe(1);
    expect(await store.listSegments(id, 0, true, 10)).toEqual([]);
  });

  it("stores and deletes standing routines", async () => {
    const store = new InMemoryStore();
    const row = {
      routineId: "rtn_01K7Q3N8R2M0K7V1C4D8E2F6GH",
      tenantId: "11111111-2222-3333-4444-555555555555",
      userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      label: "Standup",
      enabled: true,
      mode: "listen_speak" as const,
      plane: "auto" as const,
      avatar: false,
      match: { eventId: "evt-1" },
      hoursDraft: true,
      ownerMemo: false,
      createdAt: nowIso(),
    };
    await store.putRoutine(row);
    expect((await store.listRoutines(row.tenantId, row.userId))[0]?.label).toBe("Standup");
    expect(await store.deleteRoutine(row.tenantId, row.userId, row.routineId)).toBe(true);
    expect(await store.listRoutines(row.tenantId, row.userId)).toEqual([]);
  });
});
