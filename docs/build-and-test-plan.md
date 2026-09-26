# Build and test plan — TeamsConnector (FR #1 / MRB #2)

## Phases

| Phase | What “done” means | Evidence |
|-------|-------------------|----------|
| P0 Docs | FR markdown + this plan on `main` | `docs/feature-request-*.md` |
| P1 Unit CI | Node + media-worker.tests green | GitHub Actions **CI** jobs `node`, `media-worker` |
| P2 Honest canHear | Heartbeat-only → `canHear=false`; cue → true | `EarHubTests` |
| P3 Plane freeze | `plane=auto`+listen never media on healthy alone | `plane.test.ts` / `fr1-must` / `mrb2-plane.test.ts` |
| P4 Path C live | Dated row: human phrase in `GET /ear` | Manual — not CI |
| P5 Path A live | One playPrompt phrase heard by human on current HEAD | Manual — not CI |
| P6 UAT stamp | Only after P4+P5; Bob only | Never from worker |

## CI jobs (honest badge)

| Job | Covers | Explicitly **out of CI** |
|-----|--------|---------------------------|
| `node` | typecheck + vitest (incl. FR MUST) | — |
| `media-worker` | `services/media-worker.tests` (includes EarHub) | — |
| — | — | **`services/companion-ear`** (WASAPI device-dependent) |
| — | — | **`services/media-host`** full Graph/RTP join (IONOS Path B parked) |
| — | — | Amplify `POST /mcp` Bearer, live Graph join, ARR callbacks |

A green CI badge means P1–P3 only. It does **not** mean Path A audible or Path C hears humans.

## Local commands

```bash
# Node 22+
npm ci
npm run typecheck
npm test

# Windows (EarHub / PhraseCanon)
dotnet test services/media-worker.tests --nologo
```

## Live phrase log template (P4)

| UTC | Phrase | `GET /ear` contains | `canHear` | Box | Redacted log |
|-----|--------|--------------------|-----------|-----|--------------|
| _TBD_ | mirror-44 | yes/no | true only with cue | companion PC | link |

Until a row is filled, do not claim the bot can hear live.
