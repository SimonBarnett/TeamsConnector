const JOIN_PATH = /\/l\/meetup-join\//i;

export interface ParsedMeetingLocator {
  kind: "meetingUrl" | "eventId" | "onlineMeetingId";
  value: string;
  joinUrl?: string;
}

export function redactJoinUrl(raw: string, maxLength = 512): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "[redacted-join-url]";
  }
  parsed.search = "";
  parsed.hash = "";
  let out = parsed.toString();
  if (out.endsWith("/")) out = out.slice(0, -1);
  if (out.length > maxLength) {
    out = `${out.slice(0, Math.max(0, maxLength - 3))}...`;
  }
  return out;
}

export function isTeamsJoinUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return JOIN_PATH.test(url.pathname) || url.hostname.toLowerCase().includes("teams.microsoft.com");
  } catch {
    return false;
  }
}

export function meetingKey(input: {
  meetingUrl?: string;
  eventId?: string;
  onlineMeetingId?: string;
}): string {
  if (input.onlineMeetingId) return `om:${input.onlineMeetingId}`;
  if (input.eventId) return `ev:${input.eventId}`;
  if (input.meetingUrl) return `url:${redactJoinUrl(input.meetingUrl)}`;
  return "unknown";
}

export function locatorCount(input: {
  meetingUrl?: string;
  eventId?: string;
  onlineMeetingId?: string;
}): number {
  return [input.meetingUrl, input.eventId, input.onlineMeetingId].filter(
    (v) => typeof v === "string" && v.length > 0,
  ).length;
}
