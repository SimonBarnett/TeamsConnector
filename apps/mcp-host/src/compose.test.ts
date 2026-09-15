import { describe, expect, it } from "vitest";
import { composeFromEnv } from "./compose.ts";

describe("composeFromEnv", () => {
  it("refuses production boot without ARTIFACT_ENCRYPTION_KEY", async () => {
    await expect(composeFromEnv({ NODE_ENV: "production" })).rejects.toThrow(/ARTIFACT_ENCRYPTION_KEY/);
  });

  it("demo host can join and speak", async () => {
    const { orch, banner } = await composeFromEnv({ DEMO_FIXTURE: "1", NODE_ENV: "test" });
    const joined = await orch.call(
      "join_meeting",
      { onlineMeetingId: "om-priority", announce: false },
      {
        tenantId: "11111111-2222-3333-4444-555555555555",
        userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        agentId: "haitch",
        meetingConfirmed: true,
      },
    );
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const sessionId = (joined.data as { sessionId: string }).sessionId;
    const spoken = await orch.call("speak", { sessionId, text: "Hello team." }, {
      tenantId: "11111111-2222-3333-4444-555555555555",
      userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      agentId: "haitch",
      meetingConfirmed: true,
    });
    expect(spoken.ok).toBe(true);
    if (!spoken.ok) return;
    expect((spoken.data as { status: string }).status).toBe("playing");
    expect(banner).toContain("mode=fixture-loopback");
  });
});
