import { createHmac } from "node:crypto";
import type { EventEnvelope } from "@teams-audio-join/shared";
import type { EventSink } from "./events.ts";

export class WebhookEventSink implements EventSink {
  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async emit(event: EventEnvelope): Promise<void> {
    const body = JSON.stringify(event);
    const signature = createHmac("sha256", this.secret).update(body).digest("hex");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-teams-audio-join-signature": signature,
        },
        body,
        signal: ac.signal,
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`webhook ${res.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
