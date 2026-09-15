# Phase 3 workflows

This connector does **not** scrape Outlook, post Hours entries, or play memos into Teams.

## Standing listen-only routines

```json
{
  "label": "Daily standup",
  "match": { "subjectContains": "standup", "weekdays": [1, 2, 3, 4, 5], "localTime": "09:00" },
  "hoursDraft": true,
  "ownerMemo": false
}
```

Meta must include `confirmStanding: true` (or `meetingConfirmed: true`) to create a routine. Recording acknowledgement is still required. Routines default to `listen_speak` so the assistant can talk.

Matched joins skip per-meeting chat confirmation.

## Hours draft

`prepare_hours_draft` and the `hours.draft_ready` event return:

```json
{
  "source": "teams-audio-join",
  "artifactId": "art_…",
  "sessionId": "ses_…",
  "hours": 1.0,
  "label": "Priority wider catchup /w platform",
  "requiresHumanConfirm": true,
  "billableSuggested": false
}
```

The Hours agent consumes this and **must** ask a human before posting. This service never calls Hours APIs.

## Calendar trigger

Inject a `CalendarPort` (`FakeCalendar` in tests). On each tick, matching online meetings in a 2-minute start window are joined listen-only. Offline calendar events are skipped. Live-session and 2-session caps still apply.

## Owner memo

`owner.memo` is for the Grok Bot owner channel. It is not `speak()` and is not stored as attendee transcript (`owner_command` is not mixed into the meeting record).
