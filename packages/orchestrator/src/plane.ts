import { ConnectorError, type JoinMeetingRequest, type Plane } from "@teams-audio-join/shared";

export interface PlaneContext {
  mediaWorkerHealthy: boolean;
  trackBConsented: boolean;
}

export function selectPlane(req: JoinMeetingRequest, ctx: PlaneContext): Plane {
  const requested = req.plane ?? "auto";
  const needsMedia = req.mode === "listen_speak" || req.avatar === true;

  if (requested === "transcript") {
    if (needsMedia) return upgradeOrReject(ctx, req);
    return "transcript";
  }

  if (requested === "media") {
    return requireMedia(ctx);
  }

  // auto — Phase 1 default is transcript. Media if speak or avatar is requested and workers are ready.
  if (needsMedia) {
    return requireMedia(ctx, req.mode === "listen_speak" && !req.avatar ? "mode_unsupported" : undefined);
  }
  return "transcript";
}

function requireMedia(ctx: PlaneContext, preferCode?: "mode_unsupported"): Plane {
  if (!ctx.trackBConsented) {
    if (preferCode === "mode_unsupported") {
      throw new ConnectorError(
        "mode_unsupported",
        "listen_speak requires the media plane; Track B is not available. Use mode=listen or enable Track B.",
      );
    }
    throw new ConnectorError(
      "media_permission_denied",
      "Calls.AccessMedia.* missing or admin revoked.",
    );
  }
  if (!ctx.mediaWorkerHealthy) {
    if (preferCode === "mode_unsupported") {
      throw new ConnectorError(
        "mode_unsupported",
        "listen_speak requires the media plane; Track B is not available. Use mode=listen or enable Track B.",
      );
    }
    throw new ConnectorError("plane_unavailable", "Requested media plane cannot be served now (workers down).");
  }
  return "media";
}

function upgradeOrReject(ctx: PlaneContext, req: JoinMeetingRequest): Plane {
  if (ctx.trackBConsented && ctx.mediaWorkerHealthy) return "media";
  if (req.avatar) {
    throw new ConnectorError(
      "plane_unavailable",
      "avatar=true requires the media plane and cannot attach on transcript-only.",
    );
  }
  throw new ConnectorError(
    "mode_unsupported",
    "listen_speak + plane=transcript cannot auto-upgrade to media.",
  );
}
