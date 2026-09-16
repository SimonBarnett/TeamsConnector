import { describe, expect, it } from "vitest";
import { listedMcpTools } from "./mcp-schemas.ts";

describe("listedMcpTools", () => {
  it("hides Hours/calendar extras unless includeWorkflows", () => {
    const audio = listedMcpTools().map((t) => t.name);
    expect(audio).toEqual([
      "join_meeting",
      "get_meeting_status",
      "get_transcript",
      "speak",
      "cancel_speech",
      "request_summary",
      "leave_meeting",
    ]);
    expect(listedMcpTools({ includeWorkflows: true }).map((t) => t.name)).toContain("prepare_hours_draft");
  });
});
