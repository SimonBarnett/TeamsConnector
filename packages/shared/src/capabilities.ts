import type { Capabilities } from "./types.ts";
import type { Mode, Plane, SessionState, SttQuality } from "./enums.ts";

export function capabilitiesFor(input: {
  state: SessionState;
  plane: Plane;
  mode: Mode;
  stt: SttQuality;
  avatar?: boolean;
  videoSending?: boolean;
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
  const admitted =
    input.state === "listening" ||
    input.state === "listening_deaf" ||
    input.state === "speaking_enabled";
  const canShowVideo =
    input.plane === "media" &&
    Boolean(input.avatar) &&
    Boolean(input.videoSending) &&
    admitted;
  return { canHear, canSpeak, stt: input.stt, canShowVideo };
}

export function assertCapabilitiesInvariant(caps: Capabilities, state: SessionState, plane: Plane, mode: Mode): void {
  if ((state === "listening_deaf" || caps.stt === "none") && caps.canHear) {
    throw new Error("capabilities invariant: canHear must be false when deaf/none");
  }
  if ((plane === "transcript" || mode === "listen") && caps.canSpeak) {
    throw new Error("capabilities invariant: canSpeak must be false on transcript/listen");
  }
  if (plane === "transcript" && caps.canShowVideo) {
    throw new Error("capabilities invariant: canShowVideo must be false on transcript");
  }
}
