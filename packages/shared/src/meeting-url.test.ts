import { describe, expect, it } from "vitest";
import { locatorCount, meetingKey, redactJoinUrl, threadIdFromJoinUrl } from "./meeting-url.ts";
import { validateJoinMeeting } from "./validate.ts";
import { ConnectorError } from "./errors.ts";

const JOIN =
  "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=%7B%7D&pwd=SECRET99";

describe("meeting url", () => {
  it("extracts the meeting thread id from a join URL", () => {
    expect(
      threadIdFromJoinUrl(
        "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?pwd=SECRET99",
      ),
    ).toBe("19:meeting_abc@thread.v2");
  });

  it("strips query parameters including pwd", () => {
    const redacted = redactJoinUrl(JOIN);
    expect(redacted).not.toContain("pwd=");
    expect(redacted).not.toContain("SECRET99");
    expect(redacted).toContain("/l/meetup-join/");
    expect(redacted.startsWith("https://teams.microsoft.com/")).toBe(true);
  });

  it("rejects two locators", () => {
    try {
      validateJoinMeeting({
        meetingUrl: JOIN,
        eventId: "evt-1",
        mode: "listen",
      });
      expect.fail("expected invalid_argument");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      expect((err as ConnectorError).code).toBe("invalid_argument");
    }
  });

  it("accepts each locator kind alone", () => {
    expect(validateJoinMeeting({ meetingUrl: JOIN, mode: "listen" }).meetingUrl).toBeDefined();
    expect(validateJoinMeeting({ eventId: "AAMkAG", mode: "listen" }).eventId).toBe("AAMkAG");
    expect(validateJoinMeeting({ onlineMeetingId: "MSo1", mode: "listen_speak" }).mode).toBe(
      "listen_speak",
    );
  });

  it("counts locators and builds a stable meeting key from the redacted URL", () => {
    expect(locatorCount({ meetingUrl: JOIN, eventId: "x" })).toBe(2);
    expect(meetingKey({ meetingUrl: JOIN })).toContain("url:");
    expect(meetingKey({ meetingUrl: JOIN })).not.toContain("SECRET");
  });
});
