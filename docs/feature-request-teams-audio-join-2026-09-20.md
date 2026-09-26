# Feature request: Teams Audio Join — Path C companion ear + v1 MUST restatement

**Issues:** https://github.com/SimonBarnett/TeamsConnector/issues/1 · https://github.com/SimonBarnett/TeamsConnector/issues/2 (MRB FAIL)  
**Date:** 2026-09-20 (parked 2026-09-26)  
**Status:** LOCKED MUST / MUST NOT; Path C **opt-in**, not product-default hear

## Objective

Keep Path A (Track A transcripts + playPrompt speak) as the product path. Path C (WASAPI companion ear on a PC already in the meeting) is an **optional homelab ear**, not the bot identity’s default hear path, until a dated live phrase row exists.

## MUST (v1 law)

1. Default join is **listen**; `plane=auto` → **transcript**. Media only when `mode=listen_speak` or `avatar=true` **and** worker healthy + Path A consent.
2. Honest deaf-state: `canHear=false` without real cues (heartbeat alone is not enough).
3. Fixture/loopback speak → `played_locally` / `audibleInTeams: false`.
4. No day-one `Calls.AccessMedia.All`. Do not claim application-hosted media works while Path B is parked (500#1203002).
5. No WAV/PCM/Opus objects in the Node store.
6. Hours always `requiresHumanConfirm: true`. Workflow tools hidden unless `WORKFLOW_TRIGGER=1`.
7. `plane=auto` stays on transcript until `docs/spike-track-b.md` is signed for media (**not signed**).
8. Path C: do not claim live hear until a human phrase (e.g. `mirror-44`) appears in `GET /ear`.

## MUST NOT

- Hidden listener / browser Join as the product hear path
- Flip `plane=auto` to media
- Treat companion-ear as the default bot hear without an FR promoting it (this FR: Path C stays **opt-in**)
- Dump secrets / claim Graph transcript file is live captions
- Break Path A playPrompt while working Path B/C

## Path C decision (addresses MRB #2 item 1)

| Choice | Decision |
|--------|----------|
| Product default hear | Remains Track A official transcript / Path A worker |
| Companion-ear (`services/companion-ear`) | **Opt-in** operator tool on a PC already in Teams; not Amplify/MCP default |
| When to set `canHear=true` from Path C | Heartbeat **and** at least one STT cue (phrase bar) |

## Live gates still open (not this PR)

| Gate | Status |
|------|--------|
| Dated Path C row: human `mirror-44` in `GET /ear` | **Open** — needs companion PC + meeting |
| Path A speak re-hear on current HEAD | **Open** — needs live Graph worker |
| Path B unpark | Parked at 1203002 |

Do **not** stamp ready for human UAT until those live rows exist.

## Related docs

- `docs/build-and-test-plan.md`
- `docs/spike-track-b.md`, `docs/path-b-ionos-1203002.md`, `docs/path-c-companion-ear.md`
- `docs/feature-request-teams-audio-join-v1-2026-09-26.md` (issue #1 lock)
