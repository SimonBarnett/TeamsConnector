import { describe, expect, it } from "vitest";
import { HttpCalendarPort } from "./http-calendar.ts";

describe("HttpCalendarPort", () => {
  it("reads upcoming events and does not post Hours", async () => {
    const calls: string[] = [];
    const port = new HttpCalendarPort("https://calendar.example/v1", async (url) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({
          events: [
            {
              eventId: "evt-1",
              subject: "Daily standup",
              startAt: "2026-09-15T09:00:00.000Z",
              endAt: "2026-09-15T09:30:00.000Z",
              isOnlineMeeting: true,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const events = await port.listUpcoming("t", "u", new Date("2026-09-15T08:00:00.000Z"), new Date("2026-09-15T12:00:00.000Z"));
    expect(events).toHaveLength(1);
    expect(calls[0]).toContain("/upcoming");
    expect(calls.some((c) => c.includes("hours"))).toBe(false);
  });
});
