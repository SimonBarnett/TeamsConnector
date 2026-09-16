# Track B / egress decision (P0-A3)

**Choice: Path A — service-hosted Graph `playPrompt` for egress, Track A official transcripts for hearing.**

We are **not** implementing application-hosted media (`Calls.AccessMedia.All`, RTP sockets, mixed-audio STT) in this iteration. Microsoft’s current guidance treats application-hosted media bots as a poor default for AI agents. Path A matches what `GraphJoin.cs` already posts (`#microsoft.graph.serviceHostedMediaConfig`).

Consequences:

- Day-one Graph permissions: `OnlineMeetings.Read.All`, `OnlineMeetingTranscript.Read.All`, `Calls.JoinGroupCall.All`. **Do not request `Calls.AccessMedia.All`.**
- `plane=media` means: Graph `createCall` + `playPrompt` of a **synthesised** WAV (not silence). Hearing is Track A transcripts (`canHear` only when cues exist).
- Do not call this “Track B application-hosted media.” Mixed-audio STT / barge-in ≤250 ms are **not** claimed on this path.
- Default `join_meeting` mode is **listen** (Track A, `plane=auto` → transcript). `listen_speak` is explicit and fails closed with `plane_unavailable` if the worker cannot synthesise and playPrompt. Fixture speak is `played_locally` / `audibleInTeams=false`.

Exit criteria from the original spike (path A restated):

- [ ] Worker joins a scheduled test meeting (`POST /communications/calls` service-hosted)
- [ ] `speak({ text })` is heard as that text (not silence) via playPrompt
- [ ] Track A transcripts when transcription is on; `canHear=false` when off
- [ ] No WAV/PCM persisted in the Node artifact store
- [ ] 5 consecutive joins (table below)
- [ ] Admin consent friction written for **JoinGroupCall**, not AccessMedia

Do **not** flip `plane=auto` to media until this report is signed.

## Tenant

- Tenant id: *(unset on the 2026-09-16 build host — no `AZURE_*`)*
- App id:
- Test meeting:
- Date: 2026-09-16

## Results

`PUBLIC_BASE_URL` must be a public HTTPS host Graph can GET (ngrok / Cloudflare tunnel), not `http://127.0.0.1`. Worker `/health.healthy` is false when that URL is loopback.

| Attempt | Admitted | Heard phrase | Notes |
|---|---|---|---|
| 1 | | | 2026-09-16 — blocked: no Entra `AZURE_*` / speech key on this host; cannot admit a tenant meeting or prove humans heard `speak({text})`. |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |

## Consent friction

What the admin actually had to click for JoinGroupCall + transcript read.

## Decision

- [x] Path A: playPrompt egress + Track A hear
- [ ] Path B: application-hosted media (deferred)
