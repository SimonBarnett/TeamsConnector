import { describe, expect, it } from "vitest";
import { composeFromEnv } from "./compose.ts";
import { createHttpServer, handleRpc } from "./server.ts";

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
    expect(listed.result.tools.find((t) => t.name === "speak")?.inputSchema).toMatchObject({
      required: ["sessionId", "text"],
    });
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
        arguments: { onlineMeetingId: "om-priority", mode: "listen_speak", announce: false },
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
    expect(envelope.data.plane).toBe("media");
    expect((envelope.data as { mode: string }).mode).toBe("listen_speak");
    expect(envelope.data.meeting.joinUrlRedacted ?? "").not.toContain("pwd=");

    const sessionId = (envelope.data as { sessionId: string }).sessionId;
    const spoken = (await handleRpc(orch, {
      jsonrpc: "2.0",
      id: "req_speak",
      method: "tools/call",
      params: {
        name: "speak",
        arguments: { sessionId, text: "Hello, I am Haitch and I can hear you." },
        meta: {
          tenantId: "11111111-2222-3333-4444-555555555555",
          userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          agentId: "haitch",
          meetingConfirmed: true,
        },
      },
    })) as { result: { content: { text: string }[]; isError: boolean } };
    const spokenEnv = JSON.parse(spoken.result.content[0]!.text) as { ok: boolean; data: { status: string } };
    expect(spokenEnv.ok).toBe(true);
    expect(spokenEnv.data.status).toBe("playing");
  });

  it("GET / and GET /mcp explain how to POST instead of returning not found", async () => {
    const { orch, doctor } = await composeFromEnv({ DEMO_FIXTURE: "1", NODE_ENV: "test" });
    const server = createHttpServer(orch, { doctor });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };
    try {
      const home = await fetch(`http://127.0.0.1:${port}/`);
      expect(home.status).toBe(200);
      expect(await home.text()).toMatch(/List tools/);
      const asJson = await fetch(`http://127.0.0.1:${port}/?format=json`);
      const body = (await asJson.json()) as { ok: boolean; hint: string };
      expect(body.ok).toBe(true);
      expect(body.hint).toMatch(/POST JSON-RPC to \/mcp/);
      const mcpGet = await fetch(`http://127.0.0.1:${port}/mcp`);
      expect(mcpGet.status).toBe(200);
      expect(await mcpGet.text()).toMatch(/List tools/);
      const listed = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(listed.status).toBe(200);
      const ready = await fetch(`http://127.0.0.1:${port}/ready`);
      expect(ready.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
