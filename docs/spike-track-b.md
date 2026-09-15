# Track B spike report (template)

Exit criteria from the build spec:

- [ ] .NET media bot joins a scheduled test meeting
- [ ] Mixed audio streamed to STT in memory (ring buffer ≤ 10s)
- [ ] No speak / TTS
- [ ] No WAV/PCM/Opus persistence
- [ ] 5 consecutive joins in the test tenant
- [ ] Written go/no-go on admin-consent friction for `Calls.AccessMedia.All`

Do **not** flip `plane=auto` to media until this report is signed.

## Tenant

- Tenant id:
- App id:
- Test meeting:
- Date:

## Results

| Attempt | Admitted | STT partials | Notes |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |

## Consent friction

What the admin actually had to click, and whether RSC meeting-scoped permissions were enough.

## Decision

- [ ] Stay on Track A only
- [ ] Enable Track B behind a tenant flag
