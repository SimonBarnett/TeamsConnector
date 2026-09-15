import { describe, expect, it } from "vitest";
import { composeFromEnv } from "./compose.ts";
import { handleRpc } from "./server.ts";

describe("MCP host", () => {
  it("lists the seven spec tools and serves join_meeting", async () => {
    const { orch } = await composeFromEnv({
      DEMO_FIXTURE: "1",
      NODE_ENV: "test",
    });
    const listed = (await handleRpc(orch, { jsonrpc: "2.0", id: 1, method: "tools/list" })) as {
      result: { tools: { name: string }[] };
    };
    const names = listed.result.tools.map((t) => t.name);
    expect(names).toEqual([
      "join_meeting",
      "get_meeting_status",
      "get_transcript",
      "speak",
      "cancel_speech",
      "request_summary",
      "leave_meeting",
      "upsert_standing_routine",
      "list_standing_routines",
      "delete_standing_routine",
      "prepare_hours_draft",
    ]);

    const call = (await handleRpc(orch, {
      jsonrpc: "2.0",
      id: "req_7f3a",
      method: "tools/call",
      params: {
        name: "join_meeting",
        arguments: { onlineMeetingId: "om-priority", mode: "listen" },
        meta: {
          tenantId: "11111111-2222-3333-4444-555555555555",
          userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          agentId: "haitch",
          meetingConfirmed: true,
          requestId: "req_7f3a",
        },
      },
    })) as { result: { content: { text: string }[]; isError: boolean } };
    expect(call.result.isError).toBe(false);
    const envelope = JSON.parse(call.result.content[0]!.text) as {
      ok: boolean;
      data: { plane: string; meeting: { joinUrlRedacted?: string } };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.plane).toBe("transcript");
    expect(envelope.data.meeting.joinUrlRedacted ?? "").not.toContain("pwd=");
  });
});
