import type { Capabilities } from "./types.ts";
import type { Mode, Plane, SessionState, SttQuality } from "./enums.ts";

export function capabilitiesFor(input: {
  state: SessionState;
  plane: Plane;
  mode: Mode;
  stt: SttQuality;
}): Capabilities {
  const deaf =
    input.state === "listening_deaf" ||
    input.stt === "none" ||
    input.stt === "degraded";
  const canHear =
    !deaf &&
    (input.state === "listening" || input.state === "speaking_enabled") &&
    (input.stt === "live" || input.stt === "official");
  const canSpeak =
    input.plane === "media" &&
    input.mode === "listen_speak" &&
    input.state === "speaking_enabled";
  return { canHear, canSpeak, stt: input.stt };
}

export function assertCapabilitiesInvariant(caps: Capabilities, state: SessionState, plane: Plane, mode: Mode): void {
  if ((state === "listening_deaf" || caps.stt === "none") && caps.canHear) {
    throw new Error("capabilities invariant: canHear must be false when deaf/none");
  }
  if ((plane === "transcript" || mode === "listen") && caps.canSpeak) {
    throw new Error("capabilities invariant: canSpeak must be false on transcript/listen");
  }
}
