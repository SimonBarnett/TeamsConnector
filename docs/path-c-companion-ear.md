# Path C — companion ear (homelab, no Azure IaaS)

**Date:** 2026-09-19  
**Why:** Path B (`Calls.AccessMedia.All`, RTP on IONOS `:8445`) still dies with **500#1203002** after Windows firewall UDP/TCP was confirmed open. Azure Windows VMs are ~3× IONOS (£40/mo homelab). Path A speak already works.

## Recheck (this morning)

`ses_ionos_udpcheck_092538` 09:25Z into the overnight meeting (still open until 11:00Z):

- `/health` `mediaReady=true` `graph=true`
- Windows inbound **TCP 8445** and **UDP 49152–65279** allowed
- TLS 1.2 on 8445, `CN=rtp-teams.ntsa.uk`
- admit **200** `establishing`
- `52.112.22.192:40064` → `:8445` **ESTABLISHED**
- `ICall` Establishing → Terminated **500#1203002** same second

IONOS cloud panel UDP cannot be verified from inside the guest; it does not matter: Graph still SSL-fails after TCP accept. **Park Path B on this VPS.**

## Roles

| Path | Hear | Speak | Host |
|---|---|---|---|
| **A** (keep) | Graph transcript file (late, not live) | `playPrompt` WAV | Amplify + Graph (no 8445) |
| **B** (parked) | RTP mix → Azure STT | TTS PCM on the call | Application-hosted media — Azure IaaS or 1203002 |
| **C** (this) | **WASAPI loopback on a PC already in the meeting** → HTTPS PCM/chunks → Azure STT | Path A `playPrompt` | Homelab PC + existing worker |

The bot never terminates Teams RTP. Microsoft’s media cloud is unused for hear.

## Shape

1. A small **Windows companion** (same machine as Teams desktop, typically Simon’s PC — not IONOS unless someone RDP-joins Teams there).
2. Capture **loopback** (WASAPI render / “Stereo Mix” / VB-Cable if needed). Prefer the Teams meeting output device, not the mic.
3. Chunk 16 kHz mono PCM (or WAV/WebM) to the worker: `POST /ear` with `MEDIA_WORKER_SECRET`.
4. Worker runs existing **Azure STT** (`AzureStt` already on media-host; Node can call Speech too).
5. Cues land on the same session as Path A join (`canHear=true` when the companion is connected and STT returns text).
6. Speak stays **Path A** `playPrompt`. Do not mix Path B PCM send.

`plane=auto` stays **off** until a human phrase is in STT from the companion (same bar as before: e.g. `mirror-44`).

## Out of scope

- Azure `Standard_D2s_v3` / quota / M128
- Changing Club Madeira IIS
- `Calls.AccessMedia` / 8445
- Dumping `.env` on IRC
- Claiming live captions via Graph (that is still not real-time)

## Built

- `services/companion-ear` — WASAPI loopback console (`NAudio`), 16 kHz mono WAV → `POST /ear`
- media-host `POST /ear` + `GET /ear?sessionId=` (`EarHub`: heartbeat 15s → `canHear`)
- Fixture: `EarHubTests` companion off → `canHear=false`; cue → stored

IONOS: publish media-host (adds `/ear`; ARR already proxies all paths). Copy `companion-ear.exe` to the PC in the meeting. `Bob-TeamsMediaHost` can stay; Path B join is unused.

`plane=auto` stays off until a human phrase (e.g. `mirror-44`) appears in `GET /ear`.
