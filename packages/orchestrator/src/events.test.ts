import { describe, expect, it } from "vitest";
import { makeEvent, MemoryEventSink } from "./events.ts";
import type { EventSink } from "./events.ts";

describe("events", () => {
  it("makeEvent fills eventId and optional agentId", () => {
    const e = makeEvent({
      type: "artifact.ready",
      tenantId: "11111111-2222-3333-4444-555555555555",
      sessionId: "ses_01K7Q3N8R2M0K7V1C4D8E2F6GH",
      agentId: "haitch",
      payload: { n: 1 },
    });
    expect(e.eventId.startsWith("evt_")).toBe(true);
    expect(e.agentId).toBe("haitch");
  });

  it("fans out to extra sinks", async () => {
    const extra: EventSink & { n: number } = { n: 0, async emit() { this.n += 1; } };
    const mem = new MemoryEventSink([extra]);
    await mem.emit(
      makeEvent({
        type: "session.updated",
        tenantId: "11111111-2222-3333-4444-555555555555",
        sessionId: "ses_01K7Q3N8R2M0K7V1C4D8E2F6GH",
        payload: {},
      }),
    );
    expect(mem.events).toHaveLength(1);
    expect(extra.n).toBe(1);
  });
});
