import { ConnectorError, type JoinMeetingRequest, type Plane } from "@teams-audio-join/shared";

export interface PlaneContext {
  mediaWorkerHealthy: boolean;
  trackBConsented: boolean;
}

export function selectPlane(req: JoinMeetingRequest, ctx: PlaneContext): Plane {
  const requested = req.plane ?? "auto";
  const wantsSpeak = req.mode === "listen_speak" || req.avatar === true;

  // Path A freeze: auto is Track A transcripts. Media only when explicitly requested
  // and the worker is actually healthy (createCall + TTS), not loopback-as-live.
  if (requested === "auto" && !wantsSpeak) return "transcript";
  if (requested === "transcript" && !wantsSpeak) return "transcript";
  return requireMedia(ctx);
}

function requireMedia(ctx: PlaneContext): Plane {
  if (!ctx.trackBConsented) {
    throw new ConnectorError(
      "media_permission_denied",
      "listen_speak requires an enabled media worker (Path A playPrompt). Track A listen remains available.",
    );
  }
  if (!ctx.mediaWorkerHealthy) {
    throw new ConnectorError(
      "plane_unavailable",
      "Media worker is down or cannot synthesise speech; speak() is fail-closed.",
    );
  }
  return "media";
}
