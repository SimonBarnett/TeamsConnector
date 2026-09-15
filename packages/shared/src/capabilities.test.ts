import { describe, expect, it } from "vitest";
import { assertCapabilitiesInvariant, capabilitiesFor } from "./capabilities.ts";

describe("capabilities", () => {
  it("never claims hearing when deaf", () => {
    const caps = capabilitiesFor({
      state: "listening_deaf",
      plane: "transcript",
      mode: "listen",
      stt: "none",
    });
    expect(caps.canHear).toBe(false);
    expect(caps.canSpeak).toBe(false);
    expect(caps.canShowVideo).toBe(false);
    assertCapabilitiesInvariant(caps, "listening_deaf", "transcript", "listen");
  });

  it("cannot speak on the transcript plane", () => {
    const caps = capabilitiesFor({
      state: "listening",
      plane: "transcript",
      mode: "listen_speak",
      stt: "official",
    });
    expect(caps.canHear).toBe(true);
    expect(caps.canSpeak).toBe(false);
    expect(caps.canShowVideo).toBe(false);
  });

  it("never claims a camera tile on the transcript plane", () => {
    const caps = capabilitiesFor({
      state: "listening",
      plane: "transcript",
      mode: "listen",
      stt: "official",
      avatar: true,
      videoSending: true,
    });
    expect(caps.canShowVideo).toBe(false);
  });

  it("shows video only after media admit with avatar sending", () => {
    const caps = capabilitiesFor({
      state: "listening",
      plane: "media",
      mode: "listen",
      stt: "live",
      avatar: true,
      videoSending: true,
    });
    expect(caps.canShowVideo).toBe(true);
    expect(caps.canSpeak).toBe(false);
  });
});
