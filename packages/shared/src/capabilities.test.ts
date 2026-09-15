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
  });
});
