import { describe, expect, it } from "vitest";
import { HttpMediaWorker } from "./http-media-worker.ts";

describe("HttpMediaWorker", () => {
  it("posts admit/play/leave to the worker base URL", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const w = new HttpMediaWorker("http://worker:7071", async (url, init) => {
      calls.push({ url: String(url), method: init?.method, body: String(init?.body ?? "") });
      if (String(url).endsWith("/health")) return Response.json({ healthy: true, plane: "media" });
      if (String(url).endsWith("/admit")) return Response.json({ videoSending: false, canHear: true, callId: "c1" });
      if (String(url).endsWith("/play")) return Response.json({ status: "playing" });
      if (String(url).endsWith("/leave")) return Response.json({ closeLatencyMs: 3 });
      return new Response("no", { status: 404 });
    });
    expect(await w.healthy()).toBe(true);
    expect(await w.admit("ses_1", { avatar: false, speak: true, threadId: "19:meeting_abc@thread.v2" })).toEqual({
      videoSending: false,
      canHear: true,
      callId: "c1",
    });
    expect((await w.play("ses_1", {
      utteranceId: "utt_1",
      text: "Hello",
      durationMs: 800,
      allowBargeIn: true,
      priority: "normal",
    })).status).toBe("playing");
    expect((await w.leave("ses_1")).closeLatencyMs).toBe(3);
    expect(calls.some((c) => c.url.endsWith("/admit") && c.body.includes("19:meeting_abc"))).toBe(true);
  });

  it("sends the shared secret on mutating worker calls", async () => {
    const headers: string[] = [];
    const w = new HttpMediaWorker(
      "http://worker:7071",
      async (url, init) => {
        headers.push(String((init?.headers as { authorization?: string } | undefined)?.authorization ?? ""));
        if (String(url).endsWith("/cancel")) return Response.json({ cancelled: ["utt_1"], stopLatencyMs: 12 });
        return Response.json({ healthy: true });
      },
      "s3cret",
    );
    await w.cancel("ses_1", "utt_1");
    expect(headers.some((h) => h === "Bearer s3cret")).toBe(true);
  });
});
