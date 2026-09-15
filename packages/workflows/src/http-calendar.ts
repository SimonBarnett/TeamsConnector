import type { CalendarEvent, CalendarPort } from "./calendar.ts";

/** Read-only Calendar connector adapter. Never writes events. */
export class HttpCalendarPort implements CalendarPort {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly headers: Record<string, string> = {},
  ) {}

  async listUpcoming(tenantId: string, userId: string, from: Date, to: Date): Promise<CalendarEvent[]> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}/upcoming`);
    url.searchParams.set("tenantId", tenantId);
    url.searchParams.set("userId", userId);
    url.searchParams.set("from", from.toISOString());
    url.searchParams.set("to", to.toISOString());
    const res = await this.fetchImpl(url.toString(), { headers: this.headers });
    if (!res.ok) throw new Error(`calendar ${res.status}`);
    const json = (await res.json()) as { events?: CalendarEvent[] };
    return json.events ?? [];
  }
}
