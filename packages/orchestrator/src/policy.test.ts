import { describe, expect, it } from "vitest";
import { InMemoryStore } from "@teams-audio-join/store";
import { nowIso } from "@teams-audio-join/shared";
import { ConnectorError } from "@teams-audio-join/shared";
import { seedReadyTenant, TEST_TENANT, TEST_USER, testMeta } from "./seed.ts";
import { assertAck, assertBound, assertJoinConsent, assertJoinQuota } from "./policy.ts";

describe("policy", () => {
  it("fails unbound and missing ack", async () => {
    const store = new InMemoryStore();
    await expect(assertBound(store, testMeta())).rejects.toBeInstanceOf(ConnectorError);
    await store.putTenant({
      tenantId: TEST_TENANT,
      installedAt: nowIso(),
      trackAConsented: true,
      trackBConsented: false,
    });
    await store.putConnection({
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      workAccountUpn: "a@b.c",
      connectedAt: nowIso(),
    });
    await expect(assertAck(store, testMeta())).rejects.toBeInstanceOf(ConnectorError);
  });

  it("skips per-meeting confirm when a standing routine matches", async () => {
    const store = new InMemoryStore();
    await seedReadyTenant(store);
    await store.putRoutine({
      routineId: "rtn_01K7Q3N8R2M0K7V1C4D8E2F6GH",
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      label: "Catchup",
      enabled: true,
      mode: "listen_speak",
      plane: "auto",
      avatar: false,
      match: { eventId: "evt-priority" },
      hoursDraft: true,
      ownerMemo: false,
      createdAt: nowIso(),
    });
    await expect(
      assertJoinConsent(
        store,
        testMeta({ meetingConfirmed: false }),
        { mode: "listen_speak", eventId: "evt-priority" },
        { eventId: "evt-priority", subject: "Priority wider catchup" },
      ),
    ).resolves.toBeUndefined();
  });

  it("enforces two live sessions", async () => {
    const store = new InMemoryStore();
    await seedReadyTenant(store);
    for (let i = 0; i < 2; i++) {
      await store.putSession({
        sessionId: `ses_01K7Q3N8R2M0K7V1C4D8E2F6G${i}`,
        tenantId: TEST_TENANT,
        userId: TEST_USER,
        agentId: "haitch",
        state: "listening",
        plane: "transcript",
        mode: "listen",
        createdAt: nowIso(),
        meeting: {},
        meetingKey: `om:${i}`,
        announce: false,
        waitForAdmitSec: 60,
        avatar: false,
        capabilities: { canHear: true, canSpeak: false, stt: "official", canShowVideo: false },
        participants: [],
        speak: {},
      });
    }
    await expect(assertJoinQuota(store, testMeta())).rejects.toMatchObject({ code: "rate_limited" });
  });
});
