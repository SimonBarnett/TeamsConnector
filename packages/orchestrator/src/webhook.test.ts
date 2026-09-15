import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WebhookEventSink } from "./webhook.ts";
import { makeEvent } from "./events.ts";

describe("WebhookEventSink", () => {
  it("POSTs JSON with an HMAC signature", async () => {
    const event = makeEvent({
      type: "session.ended",
      tenantId: "11111111-2222-3333-4444-555555555555",
      sessionId: "ses_01K7Q3N8R2M0K7V1C4D8E2F6GH",
      payload: { reason: "user_leave" },
    });
    let seen = "";
    const sink = new WebhookEventSink("https://hooks.example/events", "s3cret", async (_url, init) => {
      seen = String(init?.headers && (init.headers as Record<string, string>)["x-teams-audio-join-signature"]);
      expect(init?.method).toBe("POST");
      const expected = createHmac("sha256", "s3cret").update(String(init?.body)).digest("hex");
      expect(seen).toBe(expected);
      return new Response(null, { status: 202 });
    });
    await sink.emit(event);
  });

  it("throws on non-2xx", async () => {
    const sink = new WebhookEventSink("https://hooks.example/events", "s3cret", async () => new Response("no", { status: 500 }));
    const event = makeEvent({
      type: "session.ended",
      tenantId: "11111111-2222-3333-4444-555555555555",
      sessionId: "ses_01K7Q3N8R2M0K7V1C4D8E2F6GH",
      payload: {},
    });
    await expect(sink.emit(event)).rejects.toThrow(/webhook 500/);
  });
});
