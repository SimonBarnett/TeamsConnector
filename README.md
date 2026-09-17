# Teams Agent Audio Join Connector

MCP connector that lets a Grok Bot agent join a Microsoft Teams meeting as **notes-only by default** (Track A official transcripts), optionally speak via Path A Graph `playPrompt`, and return grounded notes.

This repository implements build spec v1.2 plus OpenAPI 1.5.0 at `contracts/teams_audio_join.openapi.json`.

**Default `join_meeting` mode is `listen` (Track A transcripts, `plane=auto` → transcript). `listen_speak` is explicit. Fixture/loopback `speak()` returns `played_locally` with `audibleInTeams: false` — Teams attendees do not hear it. `get_meeting_status.participants` can be empty mid-call (attendance reports land after the meeting).**

## What v1 does

- Default join is **listen** (Track A official transcripts). Pass `mode=listen_speak` for Path A Graph `playPrompt` (not application-hosted media).
- Seven MCP tools: `join_meeting`, `get_meeting_status`, `get_transcript`, `speak`, `cancel_speech`, `request_summary`, `leave_meeting`. Hours/calendar tools stay hidden unless `WORKFLOW_TRIGGER=1`.
- Honest deaf-state: `canHear=false` when transcription is off. Summaries never invent a meeting from the title.
- `speak()` on a listen session upgrades to media `listen_speak` only when the Windows worker is healthy (Graph + Azure Speech + a **public** `PUBLIC_BASE_URL`). Caps, content filter, and barge-in still apply.
- Optional camera-tile still (`join_meeting.avatar=true`) is Path A send-only video, never inbound participant video.
- Standing routines, Calendar trigger, and Hours draft stay behind `WORKFLOW_TRIGGER=1`. Hours always `requiresHumanConfirm: true`.
- Encrypted transcript/artifact bodies. No WAV/PCM/Opus objects in the Node store.
- Separate Entra app from the chat-only Teams plugin. No `Calls.AccessMedia.All` on day-one install.

`plane=auto` with default `listen` stays on **transcript**. Media is used only when `mode=listen_speak` (or `avatar=true`) and the worker reports `healthy=true`. Set `MEDIA_WORKER_URL` to the Windows worker (`dotnet run --project services/media-worker`). Unset URL = local loopback (not audible in Teams). Do not flip `plane=auto` to media until `docs/spike-track-b.md` is signed.

## Layout

```
contracts/teams_audio_join.openapi.json
packages/shared        IDs, envelopes, redaction, validators
packages/store         encrypted session/artifact store + audit
packages/orchestrator  consent, state machine, plane select, tools
packages/graph         Track A Graph adapter + VTT/JSON normaliser
packages/summarizer    grounded xAI summaries
apps/mcp-host          stdio + HTTP MCP server
services/media-worker  .NET 8 Path A playPrompt worker
deploy/teams-app       Teams manifest (calling + video enabled)
deploy/avatars         Haitch 640×360 camera-tile still
docs/admin-install.md
docs/workflows.md
docs/ops.md
docs/spike-track-b.md  Path A decision + tenant spike table
reviews/               peer-review PDFs
packages/workflows     Calendar trigger + Hours draft events
```

## Run locally

Requires Node 22+.

```bash
npm install
npm test
npm run doctor
npm start
```

`npm run doctor` prints `mode=` (fixture-loopback vs Graph). Copy `.env.example` to `.env` first, or run `.\scripts\provision.ps1` on Windows to generate `ARTIFACT_ENCRYPTION_KEY`.

Demo MCP (fixture Graph meeting, no Azure — **Teams attendees will not hear TTS**):

```bash
npm start
```

Public MCP HTTP for Grok: host `apps/web` on AWS Amplify at `mcp-teams.ntsa.uk` — see `docs/amplify-ntsa.md`. Production `POST /mcp` requires `Authorization: Bearer $MCP_HTTP_SECRET`. Amplify does **not** replace the Windows media worker. Grok MCP `_meta` is not our CallMeta; the host fills the seeded Entra tenant/user (`agentId=haitch`, `meetingConfirmed=true`).

HTTP transport (`GET /ready` is the doctor):

```bash
set MCP_TRANSPORT=http
npm start
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

Unset `DATABASE_URL` is an in-memory **single-process demo**: sessions vanish on restart and a live Graph call can be orphaned until Graph times it out. Set `DATABASE_URL` for `PgStore`. Production: `ARTIFACT_ENCRYPTION_KEY` (32 bytes after base64), `AZURE_*`, `GRAPH_USER_ID`, `XAI_API_KEY`. See `docs/admin-install.md`.

## Non-goals (v1)

Video inbound, screen share, hidden listener, browser Join automation, raw-audio persistence, ACS Call Automation as the backbone, Hours auto-commit, per-agent media farms, `Calls.AccessMedia.All`.

See `docs/admin-install.md` before any tenant install. Tenant legal review is required before production join+transcribe.
