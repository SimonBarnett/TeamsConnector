import {
  newEventId,
  nowIso,
  type EventEnvelope,
  type EventType,
} from "@teams-audio-join/shared";

export interface EventSink {
  emit(event: EventEnvelope): Promise<void>;
}

export class MemoryEventSink implements EventSink {
  readonly events: EventEnvelope[] = [];
  constructor(private readonly extra: EventSink[] = []) {}

  async emit(event: EventEnvelope): Promise<void> {
    this.events.push(event);
    for (const sink of this.extra) await sink.emit(event);
  }
}

export function makeEvent(input: {
  type: EventType;
  tenantId: string;
  sessionId: string;
  agentId?: string;
  payload: Record<string, unknown>;
}): EventEnvelope {
  const event: EventEnvelope = {
    eventId: newEventId(),
    type: input.type,
    occurredAt: nowIso(),
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    payload: input.payload,
  };
  if (input.agentId) event.agentId = input.agentId;
  return event;
}
