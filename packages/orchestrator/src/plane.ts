import { ConnectorError, type JoinMeetingRequest, type Plane } from "@teams-audio-join/shared";

export interface PlaneContext {
  mediaWorkerHealthy: boolean;
  trackBConsented: boolean;
}

export function selectPlane(req: JoinMeetingRequest, ctx: PlaneContext): Plane {
  const requested = req.plane ?? "auto";

  if (requested === "transcript") {
    if (req.mode === "listen_speak") {
      return upgradeOrReject(ctx);
    }
    return "transcript";
  }

  if (requested === "media") {
    if (!ctx.trackBConsented) {
      throw new ConnectorError(
        "media_permission_denied",
        "Calls.AccessMedia.* missing or admin revoked.",
      );
    }
    if (!ctx.mediaWorkerHealthy) {
      throw new ConnectorError("plane_unavailable", "Requested media plane cannot be served now (workers down).");
    }
    return "media";
  }

  // auto — Phase 1 default is transcript. Media only if speak is required and workers are ready.
  if (req.mode === "listen_speak") {
    if (ctx.trackBConsented && ctx.mediaWorkerHealthy) return "media";
    throw new ConnectorError(
      "mode_unsupported",
      "listen_speak requires the media plane; Track B is not available. Use mode=listen or enable Track B.",
    );
  }
  return "transcript";
}

function upgradeOrReject(ctx: PlaneContext): Plane {
  if (ctx.trackBConsented && ctx.mediaWorkerHealthy) return "media";
  throw new ConnectorError(
    "mode_unsupported",
    "listen_speak + plane=transcript cannot auto-upgrade to media.",
  );
}
