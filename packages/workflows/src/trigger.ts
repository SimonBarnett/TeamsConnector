import { findMatchingRoutine, meetingKey } from "@teams-audio-join/shared";
import type { ConnectorStore } from "@teams-audio-join/store";
import { makeEvent, type EventSink, type Orchestrator } from "@teams-audio-join/orchestrator";
import type { CalendarEvent, CalendarPort } from "./calendar.ts";

const JOIN_AHEAD_MS = 2 * 60_000;

export interface TriggerOpts {
  calendar: CalendarPort;
  store: ConnectorStore;
  orch: Orchestrator;
  events: EventSink;
  tenantId: string;
  userId: string;
  agentId: string;
}

export class CalendarTrigger {
  constructor(private readonly opts: TriggerOpts) {}

  async tick(now = new Date()): Promise<{ joined: string[] }> {
    const from = new Date(now.getTime() - 5 * 60_000);
    const to = new Date(now.getTime() + 2 * 3600_000);
    const events = await this.opts.calendar.listUpcoming(this.opts.tenantId, this.opts.userId, from, to);
    const routines = await this.opts.store.listRoutines(this.opts.tenantId, this.opts.userId);
    const joined: string[] = [];

    for (const ev of events) {
      if (!ev.isOnlineMeeting) continue;
      const start = Date.parse(ev.startAt);
      const end = Date.parse(ev.endAt);
      const inWindow = start >= now.getTime() && start <= now.getTime() + JOIN_AHEAD_MS;
      const inProgress = start <= now.getTime() && end > now.getTime();
      if (!inWindow && !inProgress) continue;

      const hit = findMatchingRoutine(routines, {
        eventId: ev.eventId,
        seriesMasterId: ev.seriesMasterId,
        subject: ev.subject,
        startAt: ev.startAt,
      });
      if (!hit) continue;

      const key = meetingKey({ eventId: ev.eventId });
      const live = await this.opts.store.findLiveByMeeting(this.opts.tenantId, this.opts.userId, key);
      if (live) continue;

      const envelope = await this.opts.orch.call(
        "join_meeting",
        { eventId: ev.eventId, mode: "listen", plane: hit.plane, avatar: hit.avatar },
        {
          tenantId: this.opts.tenantId,
          userId: this.opts.userId,
          agentId: this.opts.agentId,
          meetingConfirmed: false,
        },
      );
      if (!envelope.ok) continue;
      const sessionId = (envelope.data as { sessionId: string }).sessionId;
      joined.push(sessionId);
      await this.opts.events.emit(
        makeEvent({
          type: "routine.fired",
          tenantId: this.opts.tenantId,
          sessionId,
          agentId: this.opts.agentId,
          payload: { routineId: hit.routineId, eventId: ev.eventId, sessionId },
        }),
      );
    }
    return { joined };
  }
}

export type { CalendarEvent };
