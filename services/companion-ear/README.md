# Path C companion-ear

Runs on the **Windows PC that is in the Teams meeting** (not IONOS). Captures WASAPI loopback, POSTs 16 kHz mono WAV chunks to `https://rtp-teams.ntsa.uk/ear`.

Speak stays Path A `playPrompt`. This process never talks to Graph AccessMedia.

```bat
companion-ear.exe --list
set MEDIA_WORKER_SECRET=...
companion-ear.exe --url https://rtp-teams.ntsa.uk --session ses_YOUR_SESSION
```

Ctrl+C stops. Heartbeat with silence still sets `canHear` on GET `/ear?sessionId=`.

ffmpeg v0 (if you prefer):

```bat
ffmpeg -f wasapi -i loopback -ac 1 -ar 16000 -f s16le - | curl.exe -sS -H "Authorization: Bearer %MEDIA_WORKER_SECRET%" --data-binary @- ...
```

Prefer the exe; ffmpeg still needs a wrapper to wrap WAV + JSON.

Worker: `GET /ear?sessionId=` → `{ canHear, lastText, cues }`.
