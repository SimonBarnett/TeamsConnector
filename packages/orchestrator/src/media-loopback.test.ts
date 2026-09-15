import { describe, expect, it } from "vitest";
import { LoopbackMediaWorker, UnavailableMediaWorker } from "./media-loopback.ts";

const cmd = {
  utteranceId: "utt_01K7Q3N8R2M0K7V1C4D8E2F6GH",
  text: "Hello",
  durationMs: 800,
  allowBargeIn: true,
  priority: "normal" as const,
};

describe("LoopbackMediaWorker", () => {
  it("plays, queues a second utterance, barges in on normal, skips urgent", async () => {
    const w = new LoopbackMediaWorker();
    await w.admit("ses_1", { avatar: false, speak: true });
    expect(await w.play("ses_1", cmd)).toEqual({ status: "playing" });
    expect(await w.play("ses_1", { ...cmd, utteranceId: "utt_2" })).toEqual({ status: "queued" });
    const barge = await w.bargeIn("ses_1");
    expect(barge.cancelled).toEqual(["utt_01K7Q3N8R2M0K7V1C4D8E2F6GH"]);
    expect(barge.stopLatencyMs).toBeLessThanOrEqual(400);

    await w.play("ses_1", { ...cmd, priority: "urgent", allowBargeIn: true });
    expect((await w.bargeIn("ses_1")).cancelled).toEqual([]);
  });

  it("mute cancels and leave closes quickly", async () => {
    const w = new LoopbackMediaWorker();
    await w.admit("ses_1", { avatar: true, speak: true });
    await w.play("ses_1", cmd);
    expect(await w.mute("ses_1")).toEqual({ cancelled: [cmd.utteranceId] });
    const left = await w.leave("ses_1");
    expect(left.closeLatencyMs).toBeLessThanOrEqual(2000);
  });

  it("UnavailableMediaWorker cannot admit or play", async () => {
    const w = new UnavailableMediaWorker();
    expect(await w.healthy()).toBe(false);
    await expect(w.admit("s", { avatar: false, speak: true })).rejects.toThrow(/unavailable/);
    await expect(w.play()).rejects.toThrow(/unavailable/);
  });
});
