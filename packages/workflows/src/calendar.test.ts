import { describe, expect, it } from "vitest";
import { FakeCalendar, fixtureOffline, fixtureStandup } from "./calendar.ts";

describe("FakeCalendar", () => {
  it("filters by time window and keeps offline events in the list", async () => {
    const start = new Date("2026-09-15T09:00:00.000Z");
    const cal = new FakeCalendar([fixtureStandup(start), fixtureOffline(start)]);
    const inWindow = await cal.listUpcoming("t", "u", new Date("2026-09-15T08:00:00.000Z"), new Date("2026-09-15T12:00:00.000Z"));
    expect(inWindow).toHaveLength(2);
    expect(inWindow.find((e) => e.eventId === "evt-offline")?.isOnlineMeeting).toBe(false);
    const empty = await cal.listUpcoming("t", "u", new Date("2026-09-16T00:00:00.000Z"), new Date("2026-09-16T01:00:00.000Z"));
    expect(empty).toEqual([]);
  });
});
