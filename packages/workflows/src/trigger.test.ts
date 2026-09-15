import { describe, expect, it } from "vitest";
import { InMemoryStore } from "@teams-audio-join/store";
import { FakeGraphClient, fixtureCatchup } from "@teams-audio-join/graph";
import { FixtureLlmClient } from "@teams-audio-join/summarizer";
import { LoopbackMediaWorker, MemoryEventSink, Orchestrator } from "@teams-audio-join/orchestrator";
import { seedReadyTenant, TEST_TENANT, TEST_USER, testMeta } from "../../orchestrator/src/seed.ts";
import { FakeCalendar, fixtureOffline, fixtureStandup } from "./calendar.ts";
import { CalendarTrigger } from "./trigger.ts";

describe("CalendarTrigger", () => {
  it("joins a matching online standup and skips offline events", async () => {
    const store = new InMemoryStore();
    await seedReadyTenant(store);
    const events = new MemoryEventSink();
    const start = new Date("2026-09-15T09:00:00.000Z");
    const standup = fixtureStandup(start);
    const graph = new FakeGraphClient([
      fixtureCatchup(),
      {
        eventId: standup.eventId,
        joinUrl: standup.joinUrl,
        meeting: {
          eventId: standup.eventId,
          subject: standup.subject,
          startAt: standup.startAt,
          endAt: standup.endAt,
          onlineMeetingId: "om-standup",
          joinUrlRedacted: "https://teams.microsoft.com/l/meetup-join/19%3astandup/0",
        },
        transcripts: [],
      },
    ]);
    const orch = new Orchestrator({
      store,
      graph,
      events,
      llm: new FixtureLlmClient({ summary: "Standup notes." }),
      mediaWorker: new LoopbackMediaWorker(),
    });
    await orch.call(
      "upsert_standing_routine",
      {
        label: "Daily standup",
        match: { subjectContains: "standup", weekdays: [2] },
        hoursDraft: true,
      },
      testMeta({ confirmStanding: true }),
    );

    const cal = new FakeCalendar([standup, fixtureOffline(start)]);
    const trigger = new CalendarTrigger({
      calendar: cal,
      store,
      orch,
      events,
      tenantId: TEST_TENANT,
      userId: TEST_USER,
      agentId: "haitch",
    });
    const { joined } = await trigger.tick(new Date("2026-09-15T08:59:00.000Z"));
    expect(joined.length).toBe(1);
    expect(events.events.some((e) => e.type === "routine.fired")).toBe(true);
  });
});
