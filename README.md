# Teams Agent Audio Join Connector

MCP connector that lets a Grok Bot agent join a Microsoft Teams meeting, **talk**, hear what was said, and return grounded notes.

This repository implements build spec v1.2 plus OpenAPI 1.5.0 at `contracts/teams_audio_join.openapi.json`.

## What v1 does

- Default join is `listen_speak` on the media plane so the assistant can talk. `mode=listen` is notes-only.
- Seven MCP tools: `join_meeting`, `get_meeting_status`, `get_transcript`, `speak`, `cancel_speech`, `request_summary`, `leave_meeting`.
- Honest deaf-state: `canHear=false` when transcription is off. Summaries never invent a meeting from the title.
- Speaks by default (`mode=listen_speak`, media plane). `speak()` upgrades a notes-only session when the media worker is up. Caps, content filter, and barge-in still apply.
- Optional camera-tile still (`join_meeting.avatar=true`) on Track B only: outbound NV12 loop, never inbound participant video.
- Phase 3: standing routines (default listen_speak), Calendar trigger, Hours draft (`requiresHumanConfirm: true`, never auto-posted), owner memo out of the Teams mix.
- Encrypted transcript/artifact bodies. No WAV/PCM/Opus objects.
- Separate Entra app from the chat-only Teams plugin. No `Calls.AccessMedia.All` on day-one install.

`plane=auto` prefers the media plane whenever the worker is healthy. Set `MEDIA_WORKER_ENABLED=false` only to force notes-only.

## Layout

```
contracts/teams_audio_join.openapi.json
packages/shared        IDs, envelopes, redaction, validators
packages/store         encrypted session/artifact store + audit
packages/orchestrator  consent, state machine, plane select, tools
packages/graph         Track A Graph adapter + VTT/JSON normaliser
packages/summarizer    grounded xAI summaries
apps/mcp-host          stdio + HTTP MCP server
services/media-worker  .NET 8 Track B spike
deploy/teams-app       Teams manifest (calling disabled; Track B overlay enables video)
deploy/avatars         Haitch 640×360 camera-tile still
docs/admin-install.md
docs/workflows.md
docs/ops.md
packages/workflows     Calendar trigger + Hours draft events
```

## Run locally

Requires Node 22+.

```bash
npm install
npm test
npm run typecheck
```

Demo MCP (fixture Graph meeting, no Azure):

```bash
npx tsx apps/mcp-host/src/main.ts
```

HTTP transport:

```bash
set MCP_TRANSPORT=http
npx tsx apps/mcp-host/src/main.ts
```

Call `join_meeting` with demo meta:

```json
{
  "tenantId": "11111111-2222-3333-4444-555555555555",
  "userId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "agentId": "haitch",
  "meetingConfirmed": true
}
```

Postgres for local persistence:

```bash
docker compose up -d
```

Copy `.env.example` to `.env`. Production needs `ARTIFACT_ENCRYPTION_KEY` (32-byte base64), Graph app credentials, and `XAI_API_KEY` for real summaries.

## Non-goals (v1)

Video, screen share, hidden listener, browser Join automation, raw-audio persistence, ACS Call Automation as the backbone, Hours auto-commit, per-agent media farms.

See `docs/admin-install.md` before any tenant install. Tenant legal review is required before production join+transcribe.
