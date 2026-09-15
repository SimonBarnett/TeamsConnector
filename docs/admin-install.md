# Admin install — Teams Agent Audio Join Connector

This connector is a **different Entra app** from the chat-only Teams plugin. Do not add `Calls.*` permissions to the chat app.

Display name default: `Haitch (audio assistant)`. It must be obviously non-human.

## Phase 1 (Track A — official transcripts)

1. Register `teams-audio-join-connector` in Entra ID.
2. Create a client secret or certificate. Store it in the platform secret store, never in agent chat.
3. Application permissions (admin consent):
   - `OnlineMeetings.Read.All`
   - `OnlineMeetingTranscript.Read.All`
4. Prefer resource-specific consent when the assistant is added to a specific meeting chat:
   - `OnlineMeetingTranscript.Read.Chat`
5. **Application access policy.** App-only `OnlineMeetings.Read.All` does not work tenant-wide without a policy granted to the connecting user or a service mailbox. Example:

   ```powershell
   New-CsApplicationAccessPolicy -Identity "teams-audio-join-policy" -AppIds "<APP_ID>"
   Grant-CsApplicationAccessPolicy -PolicyName "teams-audio-join-policy" -Identity "<USER_OBJECT_ID>"
   ```

6. Sideload `deploy/teams-app/manifest.json` (`supportsCalling=false`, `supportsVideo=false`).
7. User connects their work account to the connector.
8. Before the first transcript attach, store a recording/transcription acknowledgement with timestamp. Treat join+transcribe as potential recording under local law.
9. Per-meeting confirmation in the agent chat, unless a standing **listen-only** routine matches. Recording acknowledgement is still required. See `docs/workflows.md`.

Do **not** request on day one:

- `Calls.JoinGroupCall.All`
- `Calls.JoinGroupCallAsGuest.All`
- `Calls.AccessMedia.All`
- `Calls.Initiate.All`

## Phase 2 / Track B (only after the spike report)

See `docs/spike-track-b.md`. Requires Windows media workers, calling webhooks, and tenant opt-in for Calls media permissions. Lobby admit is mandatory. Organizer eject / `leave_meeting` must close media sockets within 2 seconds.

Use `deploy/teams-app/manifest.track-b.json` for this path (`supportsCalling` and `supportsVideo` true). The Phase 1 sidecar stays `supportsVideo=false`.

### Speak (Phase 2)

`join_meeting` defaults to `mode=listen_speak` (the assistant can talk). Then `speak({ text })`:

- Plain text only, max 280 characters. No SSML.
- Hard caps: 6 played utterances / session, 15 s cooldown after play start, queue depth 1.
- Content filter rejects secrets, join URLs, SSML, and payment/PII templates (`content_filtered`).
- Barge-in: ≥ 250 ms of human speech cancels a playing **normal** utterance; stop sending frames within 400 ms. `urgent` is not barged.
- Organizer mute cancels TTS and sets `canSpeak=false`. Eject / `leave_meeting` closes media sockets within 2 s.
- TTS echo is labelled `speakerKind=assistant` / `source=agent_tts_echo` and excluded from actions by default.

### Camera-tile avatar

`join_meeting({ avatar: true })` sends the bundled Haitch still (`deploy/avatars/haitch-360.png`) as **outbound** main video only:

- 640×360 NV12 at 7.5 fps
- No inbound video sockets, no VBSS, no `Subscribe` on participant cameras
- Allowed with `mode=listen` (does not imply speak)
- Fails with `media_permission_denied` / `plane_unavailable` if Track B is not available — it will not fake a tile on Track A


## Kill switch

- User `leave_meeting` returns within 5s.
- Organizer eject ends the session with `reason=ejected`.
- There is no hidden-listener mode. The bot stays on the roster.

## Secrets

Never put client secrets, join passwords, lobby pins, or Graph tokens in:

- agent chat
- `joinUrlRedacted`
- transcript segments
- summaries
- logs

Join-URL query strings are stripped before any model-visible payload.
