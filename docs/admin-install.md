# Admin install — Teams Agent Audio Join Connector

One Entra app. One Teams manifest (`deploy/teams-app/manifest.json`). The assistant **talks** by default.

Do **not** add `Calls.*` to the existing chat-only Teams plugin. This is a separate app.

Display name: `Haitch (audio assistant)` (obviously non-human).

## Quick start

```powershell
.\scripts\provision.ps1
# then fill AZURE_* in .env
npm install
npm run doctor
```

`npm run doctor` (or `GET /ready` on HTTP) must be green before a tenant demo. It will tell you if you are still on **fixture-loopback** (process-local speak; Teams humans will not hear it).

## Entra

1. Register `teams-audio-join-connector`.
2. Client secret or certificate → `AZURE_CLIENT_SECRET` in `.env` (never in agent chat).
3. Admin-consent application permissions:
   - `OnlineMeetings.Read.All`
   - `OnlineMeetingTranscript.Read.All`
   - `Calls.JoinGroupCall.All`
   - `Calls.AccessMedia.All` (required to be heard in the meeting)
4. Prefer RSC `OnlineMeetingTranscript.Read.Chat` when the bot is in a specific meeting chat.
5. **Application access policy** — without this, Graph returns 404 and the connector reports `meeting_not_found`:

   ```powershell
   New-CsApplicationAccessPolicy -Identity "teams-audio-join-policy" -AppIds "<APP_ID>"
   Grant-CsApplicationAccessPolicy -PolicyName "teams-audio-join-policy" -Identity "<USER_OBJECT_ID>"
   ```

6. Sideload `deploy/teams-app/manifest.json` (`supportsCalling=true`, `supportsVideo=true`). Replace `{{APP_ID}}` / `{{BOT_ID}}`.

7. **Media worker** (required for attendees to hear the bot):

   ```powershell
   $env:AZURE_TENANT_ID="..."
   $env:AZURE_CLIENT_ID="..."
   $env:AZURE_CLIENT_SECRET="..."
   $env:CALLBACK_URI="https://<public-host>/callback"
   $env:PUBLIC_BASE_URL="https://<public-host>"
   dotnet run --project services/media-worker --urls http://127.0.0.1:7071
   ```

   In the Node `.env`: `MEDIA_WORKER_URL=http://127.0.0.1:7071`. Graph `createCall` needs a **public HTTPS** `CALLBACK_URI` (tunnel/ngrok). Localhost callbacks are rejected.
7. User binds their work account. Store a recording/transcription acknowledgement before the first attach. Local law still applies.

## What `npm run doctor` means

| `mode=` | Meaning |
|---|---|
| `fixture-loopback` | No Azure creds. Demo Graph + in-process TTS. Not audible in Teams. |
| `graph-notes-only` | Graph token works; no media worker. Assistant cannot speak into Teams. |
| `graph-waiting-for-worker` | Graph + `MEDIA_WORKER_URL` set. Still in-process loopback until Graph `createCall` is wired on the Windows worker. |

`DATABASE_URL` is **not** persistence yet. If you set it, `/ready` fails on purpose so you do not think sessions survive restart.

## Kill switch

- `leave_meeting` within 5s
- Organizer eject → `reason=ejected`
- No hidden-listener mode

## Secrets

Never put client secrets, join passwords, lobby pins, or Graph tokens in agent chat, `joinUrlRedacted`, transcripts, summaries, or logs.
