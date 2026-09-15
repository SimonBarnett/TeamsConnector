import { nowIso } from "@teams-audio-join/shared";
import type { ConnectorStore } from "@teams-audio-join/store";

export const TEST_TENANT = "11111111-2222-3333-4444-555555555555";
export const TEST_USER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

export async function seedReadyTenant(store: ConnectorStore, opts?: { trackB?: boolean }): Promise<void> {
  await store.putTenant({
    tenantId: TEST_TENANT,
    installedAt: nowIso(),
    trackAConsented: true,
    trackBConsented: Boolean(opts?.trackB),
  });
  await store.putConnection({
    tenantId: TEST_TENANT,
    userId: TEST_USER,
    workAccountUpn: "simon@example.com",
    connectedAt: nowIso(),
    graphUserId: "user-simon",
  });
  await store.putAck({
    tenantId: TEST_TENANT,
    userId: TEST_USER,
    acknowledgedAt: nowIso(),
  });
}

export function testMeta(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TEST_TENANT,
    userId: TEST_USER,
    agentId: "haitch",
    meetingConfirmed: true,
    requestId: "req_test",
    ...overrides,
  };
}
