import {
  ConnectorError,
  findMatchingRoutine,
  meetingKey,
  type CallMeta,
  type JoinMeetingRequest,
  type MeetingRef,
} from "@teams-audio-join/shared";
import type { ConnectorStore } from "@teams-audio-join/store";

const JOIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_JOINS = 10;
const MAX_LIVE = 2;

export async function assertBound(store: ConnectorStore, meta: CallMeta): Promise<void> {
  const conn = await store.getConnection(meta.tenantId, meta.userId);
  if (!conn) {
    throw new ConnectorError("unauthenticated", "No bound work account, or token expired and refresh failed.");
  }
  const tenant = await store.getTenant(meta.tenantId);
  if (!tenant?.trackAConsented) {
    throw new ConnectorError("unauthenticated", "Tenant admin has not installed the audio-join app.");
  }
}

export async function assertAck(store: ConnectorStore, meta: CallMeta): Promise<void> {
  const ack = await store.getAck(meta.tenantId, meta.userId);
  if (!ack) {
    throw new ConnectorError(
      "consent_required",
      "Recording/transcription acknowledgement is missing for this tenant user.",
    );
  }
}

export async function assertJoinConsent(
  store: ConnectorStore,
  meta: CallMeta,
  req: JoinMeetingRequest,
  meeting?: MeetingRef,
): Promise<void> {
  await assertBound(store, meta);
  await assertAck(store, meta);

  if (meta.meetingConfirmed) return;

  const routines = await store.listRoutines(meta.tenantId, meta.userId);
  const hit = findMatchingRoutine(routines, {
    eventId: req.eventId ?? meeting?.eventId,
    subject: meeting?.subject,
    startAt: meeting?.startAt,
    meetingKey: meetingKey(req),
  });
  if (hit) return;
  throw new ConnectorError(
    "consent_required",
    "Per-meeting confirmation is required unless a standing allow-list matches.",
  );
}

export async function assertJoinQuota(store: ConnectorStore, meta: CallMeta): Promise<void> {
  const since = Date.now() - JOIN_WINDOW_MS;
  const joins = await store.countJoinsSince(meta.tenantId, meta.userId, since);
  if (joins >= MAX_JOINS) {
    throw new ConnectorError("rate_limited", "Join rate limit exceeded (10 / user / 10 min).", {
      retryAfterMs: JOIN_WINDOW_MS,
    });
  }

  const live = await store.listLiveByUser(meta.tenantId, meta.userId);
  if (live.length >= MAX_LIVE) {
    throw new ConnectorError("rate_limited", "At most 2 concurrent live sessions per user.", {
      retryAfterMs: 30_000,
    });
  }
}

export async function assertTrackBConsent(store: ConnectorStore, tenantId: string): Promise<void> {
  const tenant = await store.getTenant(tenantId);
  if (!tenant?.trackBConsented) {
    throw new ConnectorError(
      "media_permission_denied",
      "Calls.AccessMedia is not consented for this tenant. Track B is opt-in.",
    );
  }
}
