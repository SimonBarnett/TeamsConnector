# Operations (Phase 4)

## Persistence

Set `DATABASE_URL` to use `PgStore` (docker compose postgres:16). `/ready` postgres is green only after `SELECT 1` succeeds. Unset URL = in-memory. Production must set `ARTIFACT_ENCRYPTION_KEY` (32-byte base64). TTL default 14 days; audit is not swept.

`GET /ready` is the install doctor (`npm run doctor`). `GET /health` is liveness only.

`GET /metrics` (HTTP transport) exposes counters: `join_success`, `plane_selected_transcript`, `plane_selected_media`. Histograms: `leave_latency_ms_*`, `summary_latency_ms_*` as they are recorded.

Correlate logs on `sessionId`. Never log join-URL query strings.

## Alerts (runbook)

- `join_success` rate < 90% over 15 minutes
- Rising `listening_deaf` / `canHear=false` sessions
- Secret-scan hits (`redacted=true` spikes)

## Track A live ingest

On join, the orchestrator subscribes to Graph transcript change notifications when the client supports it, and otherwise (or in addition) can poll (`pollMs`). Notifications call `refreshTranscripts` and emit `transcript.delta`.

## Calendar trigger

`CALENDAR_CONNECTOR_URL` + `WORKFLOW_TRIGGER=1` ticks `HttpCalendarPort` (or FakeCalendar if the URL is unset). This connector still does not write Hours.

## Media rejoin

One silent `admit` retry after a worker crash. A second failure fails the join with `dependency_unavailable`.
