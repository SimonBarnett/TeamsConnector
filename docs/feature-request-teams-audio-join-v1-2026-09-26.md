# Feature request: Teams Agent Audio Join v1 — listen-default, Path A speak, honest canHear

**Issue:** https://github.com/SimonBarnett/TeamsConnector/issues/1  
**Date:** 2026-09-26  
**Status:** LOCKED acceptance from README v1.5.0 + spike docs (intake FR)

## Objective

Ship / keep a Teams MCP connector whose **default** join is notes-only (Track A transcripts), Path A `playPrompt` speak is explicit and honest about fixture deafness, and media/`Calls.AccessMedia` claims stay fail-closed until spike-signed.

## Success metrics (LOCKED)

| ID | Metric | Pass |
|----|--------|------|
| M1 | Default `join_meeting` mode | `listen`; `plane=auto` → `transcript` |
| M2 | Media plane | Only when `mode=listen_speak` or `avatar=true` **and** worker `healthy=true` (+ Path A consent) |
| M3 | Honest deaf-state | `canHear=false` without real cues; summaries do not invent a meeting from the title |
| M4 | Fixture speak | Loopback/fixture `speak()` → `played_locally`, `audibleInTeams: false` |
| M5 | Day-one Graph | No `Calls.AccessMedia.All` on install; do not claim application-hosted media works |
| M6 | Store | No WAV/PCM/Opus objects in the Node store |
| M7 | Hours | Always `requiresHumanConfirm: true`; workflow tools hidden unless `WORKFLOW_TRIGGER=1` |
| M8 | `plane=auto` | Stays on **transcript** until `docs/spike-track-b.md` is signed for media (it is not) |
| M9 | Path C hear bar | Human phrase (e.g. `mirror-44`) in `GET /ear` before claiming live hear |

## MUST NOT

- Hidden listener / browser Join as the product hear path
- Flip `plane=auto` to media
- Dump `.env` / secrets
- Claim Graph transcript file is live captions
- Break Path A playPrompt while adding Path B/C

## Source docs

- README (v1.5.0)
- `docs/spike-track-b.md` — Path A chosen
- `docs/path-b-ionos-1203002.md` — Path B parked
- `docs/path-c-companion-ear.md` — Path C companion ear
- `contracts/teams_audio_join.openapi.json`
- Build spec: `Teams_Agent_Audio_Join_Connector_Build_Spec.docx`

## Gap vs tree (2026-09-26)

Implementation already encodes M1–M8 in orchestrator/shared (plane select, loopback admit `canHear:false`, fixture speak, workflow gating). This FR parks the law in `/docs` and adds a single acceptance suite (`packages/orchestrator/src/fr1-must.test.ts`) so regressions fail CI. Path C (M9) remains documented in `docs/path-c-companion-ear.md` / companion-ear service — verify live ear phrase before product “live hear” claims.

## Build / test

See `docs/build-and-test-plan.md`.
