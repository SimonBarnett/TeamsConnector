export interface CalendarEvent {
  eventId: string;
  subject: string;
  startAt: string;
  endAt: string;
  joinUrl?: string;
  seriesMasterId?: string;
  isOnlineMeeting: boolean;
}

export interface CalendarPort {
  listUpcoming(tenantId: string, userId: string, from: Date, to: Date): Promise<CalendarEvent[]>;
}

export class FakeCalendar implements CalendarPort {
  constructor(public events: CalendarEvent[] = []) {}

  async listUpcoming(_tenantId: string, _userId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    return this.events.filter((e) => {
      const s = Date.parse(e.startAt);
      const end = Date.parse(e.endAt);
      return end >= from.getTime() && s <= to.getTime();
    });
  }
}

export function fixtureStandup(start: Date): CalendarEvent {
  const end = new Date(start.getTime() + 30 * 60_000);
  return {
    eventId: "evt-standup",
    subject: "Daily standup",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    seriesMasterId: "series-standup",
    isOnlineMeeting: true,
    joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3astandup/0",
  };
}

export function fixtureOffline(start: Date): CalendarEvent {
  return {
    eventId: "evt-offline",
    subject: "Lunch",
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 3600_000).toISOString(),
    isOnlineMeeting: false,
  };
}
