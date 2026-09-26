# Build and test plan — TeamsConnector FR #1

## Scope

Lock v1 MUST rules from `docs/feature-request-teams-audio-join-v1-2026-09-26.md` / issue #1. No media-plane flip; no day-one AccessMedia.

## Fuel / machine

Prefer Cursor Models if remaining > 0; else grok-build. Windows box needed only for live media-worker / Path C ear checks (optional after unit gate).

## Steps

1. `npm install` (Node ≥ 22)
2. `npm test` — must include `fr1-must` acceptance
3. `npm run typecheck`
4. `npm run doctor` (fixture mode OK)
5. Optional live: Windows `dotnet test` under `services/media-worker.tests` when changing Path A worker

## Acceptance gate (CI)

```bash
npm test
npm run typecheck
```

PASS when:

- Default join stays `listen` / `plane=auto` → transcript
- `listen_speak` / avatar require healthy consented worker
- Loopback admit `canHear: false`; fixture speak not `audibleInTeams`
- Workflow MCP tools hidden without `WORKFLOW_TRIGGER=1`
- Hours drafts require human confirm (types + workflow tests)

## Out of scope this FR

- Signing Track B spike / flipping `plane=auto` to media
- Graph 500#1203002 Path B unblock
- Claiming live captions from Graph transcript files
