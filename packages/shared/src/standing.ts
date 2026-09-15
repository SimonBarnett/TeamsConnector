import type { StandingMatch, StandingRoutine } from "./types.ts";

export interface MeetingMatchInput {
  eventId?: string;
  seriesMasterId?: string;
  subject?: string;
  startAt?: string;
  meetingKey?: string;
}

/** Monday=1 … Sunday=7 from a UTC timestamp. */
export function weekdayMon1(iso: string): number {
  const d = new Date(iso);
  const u = d.getUTCDay();
  return u === 0 ? 7 : u;
}

export function hhmmUtc(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function withinLocalTime(startAt: string, localTime: string, windowMin = 15): boolean {
  const a = minutesOf(hhmmUtc(startAt));
  const b = minutesOf(localTime);
  let diff = Math.abs(a - b);
  if (diff > 12 * 60) diff = 24 * 60 - diff;
  return diff <= windowMin;
}

export function matchHasLocator(match: StandingMatch): boolean {
  return Boolean(match.subjectContains || match.seriesMasterId || match.eventId);
}

export function matchesRoutine(routine: StandingRoutine, input: MeetingMatchInput): boolean {
  if (!routine.enabled) return false;
  const m = routine.match;
  if (m.eventId) {
    if (!input.eventId || input.eventId !== m.eventId) return false;
  }
  if (m.seriesMasterId) {
    if (!input.seriesMasterId || input.seriesMasterId !== m.seriesMasterId) return false;
  }
  if (m.subjectContains) {
    const sub = (input.subject ?? "").toLowerCase();
    if (!sub.includes(m.subjectContains.toLowerCase())) return false;
  }
  if (m.weekdays && m.weekdays.length > 0) {
    if (!input.startAt) return false;
    if (!m.weekdays.includes(weekdayMon1(input.startAt))) return false;
  }
  if (m.localTime) {
    if (!input.startAt) return false;
    if (!withinLocalTime(input.startAt, m.localTime)) return false;
  }
  return matchHasLocator(m);
}

export function findMatchingRoutine(
  routines: StandingRoutine[],
  input: MeetingMatchInput,
): StandingRoutine | undefined {
  return routines.find((r) => matchesRoutine(r, input));
}
