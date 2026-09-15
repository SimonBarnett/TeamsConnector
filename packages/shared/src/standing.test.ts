import { describe, expect, it } from "vitest";
import { matchesRoutine, type StandingRoutine } from "./index.ts";

function routine(match: StandingRoutine["match"]): StandingRoutine {
  return {
    routineId: "rtn_01K7Q3N8R2M0K7V1C4D8E2F6GH",
    tenantId: "11111111-2222-3333-4444-555555555555",
    userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    label: "Daily standup",
    enabled: true,
    mode: "listen",
    plane: "auto",
    avatar: false,
    match,
    hoursDraft: true,
    ownerMemo: false,
    createdAt: "2026-09-15T08:00:00.000Z",
  };
}

describe("standing match", () => {
  it("matches subject + weekday", () => {
    // 2026-09-15 is Tuesday (2)
    expect(
      matchesRoutine(routine({ subjectContains: "standup", weekdays: [2] }), {
        subject: "Daily standup",
        startAt: "2026-09-15T09:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      matchesRoutine(routine({ subjectContains: "standup", weekdays: [1] }), {
        subject: "Daily standup",
        startAt: "2026-09-15T09:00:00.000Z",
      }),
    ).toBe(false);
  });
});
