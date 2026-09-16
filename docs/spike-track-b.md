# Track B / egress decision (P0-A3)

**Choice: Path A — service-hosted Graph `playPrompt` for egress, Track A official transcripts for hearing.**

We are **not** implementing application-hosted media (`Calls.AccessMedia.All`, RTP sockets, mixed-audio STT) in this iteration. Microsoft’s current guidance treats application-hosted media bots as a poor default for AI agents. Path A matches what `GraphJoin.cs` already posts (`#microsoft.graph.serviceHostedMediaConfig`).

Consequences:

- Day-one Graph permissions: `OnlineMeetings.Read.All`, `OnlineMeetingTranscript.Read.All`, `Calls.JoinGroupCall.All`. **Do not request `Calls.AccessMedia.All`.**
- `plane=media` means: Graph `createCall` + `playPrompt` of a **synthesised** WAV (not silence). Hearing is Track A transcripts (`canHear` only when cues exist).
- Do not call this “Track B application-hosted media.” Mixed-audio STT / barge-in ≤250 ms are **not** claimed on this path.
- Default `join_meeting` mode is **listen** (Track A, `plane=auto` → transcript). `listen_speak` is explicit and fails closed with `plane_unavailable` if the worker cannot synthesise and playPrompt. Fixture speak is `played_locally` / `audibleInTeams=false`.

Exit criteria from the original spike (path A restated):

- [x] Worker joins a scheduled test meeting (`POST /communications/calls` service-hosted) — 2026-09-16 attempt 1
- [x] `speak({ text })` is heard as that text (not silence) via playPrompt — Simon heard `The test phrase is sunflower-42`
- [x] Track A transcripts when Graph has a transcript resource; `canHear=true` with official cues (2026-09-17). Live captions ≠ Graph file — item appeared after transcription stopped + `EnableGraphTranscriptAccess`. `canHear=false` before that. Off-during-meeting not re-tested (Graph file remains).
- [x] No WAV/PCM persisted in the Node artifact store (playPrompt WAV lives in the worker with GUID + TTL)
- [x] 5 consecutive joins (table below) — **5 of 5** (same scheduled meeting, unique phrases)
- [x] Admin consent friction written for **JoinGroupCall**, not AccessMedia

Do **not** flip `plane=auto` to media until this report is signed (five dated rows).

## Tenant

- Tenant id: `9792d1d6-9123-4e4c-ae29-ca81bc02d3de` (MEDATECH UK LTD / medatechuk.com)
- App id: `1c272d37-8a99-4e92-85dc-956f1d1c991d` (`teams-audio-join-connector`)
- Azure Bot: `teams-audio-join-bot` (Teams channel, `enableCalling: true`)
- Test meeting: `https://teams.microsoft.com/meet/338177153897024` (Simon organizer)
- Date: 2026-09-16

## Results

`PUBLIC_BASE_URL` must be a public HTTPS host Graph can GET (ngrok / Cloudflare tunnel), not `http://127.0.0.1`. Worker `/health.healthy` is false when that URL is loopback.

| Attempt | Admitted | Heard phrase | Notes |
|---|---|---|---|
| 1 | [x] | The test phrase is sunflower-42 | 2026-09-16 ~22:40 UTC. `listen_speak`. Graph GET `PUBLIC_BASE_URL/prompts/{guid}.wav` **200** (96844 bytes). Speak JSON `status=playing`, `audibleInTeams=true`. Human (Simon) confirmed heard. Tunnel `democratic-smilies-looking-iowa.trycloudflare.com`. createCall needed organizer `user.tenantId` + `source.application` (7505 without that). |
| 2 | [x] | The second test phrase is bluebird-17 | 2026-09-16 same meeting. Speak `playing` / `audibleInTeams=true`. Human confirmed heard. |
| 3 | [x] | The third test phrase is copper-99 | 2026-09-16 same meeting. Speak `playing` / `audibleInTeams=true`. Human confirmed heard. |
| 4 | [x] | The fourth test phrase is maple-4 | 2026-09-16 same meeting. Speak `playing` / `audibleInTeams=true`. Human confirmed heard. |
| 5 | [x] | The fifth test phrase is lantern-5 | 2026-09-16 same meeting. Speak `playing` / `audibleInTeams=true`. Human confirmed heard. |

## Consent friction

What the admin actually had to click for JoinGroupCall + transcript read (MEDATECH UK LTD, Simon Global Admin):

1. Entra **App registrations** → `teams-audio-join-connector` (single tenant). Client secret. **Not** the chat plugin.
2. Application permissions + **Grant admin consent**: `OnlineMeetings.Read.All`, `OnlineMeetingTranscript.Read.All`, `Calls.JoinGroupCall.All`. No `Calls.AccessMedia.All`.
3. Teams PowerShell `New-CsApplicationAccessPolicy` / `Grant-CsApplicationAccessPolicy` on Simon’s user object id. Policy **AppIds** must be the Manifest `appId` (screenshot OCR of client id caused `policy_missing` until `Set-CsApplicationAccessPolicy`).
4. This tenant had **zero Azure subscriptions**. Personal PAYG (`Azure subscription 1`) + Speech **Free F0** UK South for Neural TTS.
5. Azure Bot `teams-audio-join-bot` using **existing** app id, then `az bot msteams create --enable-calling true` (portal Channels blade was blank). Until Calling was on, Graph `createCall` was **7503** not registered in store; then **7505** until createCall payload put `tenantId` on organizer user + source application.
6. `PUBLIC_BASE_URL` / `CALLBACK_URI` must be Cloudflare/ngrok HTTPS. Loopback is rejected. Quick tunnels expire (~10h) and the hostname changes.

Doctor `/ready` was green (Graph + media healthy) before the join.

## Decision

- [x] Path A: playPrompt egress + Track A hear
- [ ] Path B: application-hosted media (deferred)
- [ ] Signed for `plane=auto` → media — **not yet** (Track A `canHear` on/off still untested)
