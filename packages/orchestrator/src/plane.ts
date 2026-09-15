import { ConnectorError, type JoinMeetingRequest, type Plane } from "@teams-audio-join/shared";

export interface PlaneContext {
  mediaWorkerHealthy: boolean;
  trackBConsented: boolean;
}

export function selectPlane(req: JoinMeetingRequest, ctx: PlaneContext): Plane {
  const requested = req.plane ?? "auto";
  const wantsSpeak = req.mode !== "listen" || req.avatar === true;

  if (requested === "transcript") {
    if (wantsSpeak) return requireMedia(ctx);
    return "transcript";
  }

  if (requested === "media") {
    return requireMedia(ctx);
  }

  // auto: prefer media so the assistant can talk. Transcript only if the worker is down
  // and the caller explicitly asked for listen-only.
  if (ctx.mediaWorkerHealthy) return "media";
  if (req.mode === "listen" && !req.avatar) return "transcript";
  return requireMedia(ctx);
}

function requireMedia(ctx: PlaneContext): Plane {
  if (!ctx.mediaWorkerHealthy) {
    throw new ConnectorError(
      "plane_unavailable",
      "Media worker is down; the assistant cannot speak into the meeting.",
    );
  }
  return "media";
}
