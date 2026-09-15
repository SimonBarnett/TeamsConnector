import { describe, expect, it } from "vitest";
import { FakeGraphClient, fixtureCatchup } from "./fake.ts";

describe("FakeGraphClient", () => {
  it("resolves meetingUrl, eventId, and onlineMeetingId", async () => {
    const g = new FakeGraphClient([fixtureCatchup()]);
    const join =
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=%7B%7D&pwd=SECRET99";
    expect((await g.resolveMeeting({ meetingUrl: join }))?.subject).toBe("Priority wider catchup");
    expect((await g.resolveMeeting({ eventId: "evt-priority" }))?.onlineMeetingId).toBe("om-priority");
    expect((await g.resolveMeeting({ onlineMeetingId: "om-priority" }))?.eventId).toBe("evt-priority");
  });

  it("pushTranscript notifies subscribers", async () => {
    const g = new FakeGraphClient([fixtureCatchup()]);
    let n = 0;
    await g.subscribeTranscripts("om-priority", () => {
      n += 1;
    });
    g.pushTranscript("om-priority", "tr-2", "WEBVTT\n\n00:01:00.000 --> 00:01:01.000\nHi\n");
    expect(n).toBe(1);
    expect((await g.listTranscripts("om-priority")).some((t) => t.id === "tr-2")).toBe(true);
  });
});
