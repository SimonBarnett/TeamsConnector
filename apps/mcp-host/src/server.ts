import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { MCP_TOOLS, type Envelope } from "@teams-audio-join/shared";
import type { Orchestrator } from "@teams-audio-join/orchestrator";
import type { DoctorReport } from "./doctor.ts";

interface JsonRpcReq {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: unknown;
    meta?: unknown;
    _meta?: unknown;
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(json);
}

export async function handleRpc(orch: Orchestrator, msg: JsonRpcReq): Promise<unknown> {
  const id = msg.id ?? null;
  if (msg.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "teams-audio-join", version: "1.5.0" },
      },
    };
  }
  if (msg.method === "notifications/initialized" || msg.method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }
  if (msg.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: { type: "object", additionalProperties: true },
        })),
      },
    };
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name ?? "";
    const args = msg.params?.arguments ?? {};
    const meta = msg.params?.meta ?? msg.params?._meta ?? {};
    const envelope: Envelope<unknown> = await orch.call(name, args, meta);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(envelope) }],
        isError: envelope.ok === false,
      },
    };
  }
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Unknown method ${msg.method}` },
  };
}

export function createHttpServer(
  orch: Orchestrator,
  hooks?: { doctor?: () => Promise<DoctorReport> },
) {
  return createServer(async (req, res) => {
    try {
      const path = req.url?.split("?")[0] ?? "";
      if (req.method === "GET" && (path === "/health" || path === "/ready")) {
        if (hooks?.doctor && path === "/ready") {
          const report = await hooks.doctor();
          send(res, report.ok ? 200 : 503, report);
          return;
        }
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && req.url === "/metrics") {
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
        res.end(orch.metrics.renderPrometheus());
        return;
      }
      if (req.method === "POST" && (req.url === "/mcp" || req.url === "/")) {
        const raw = await readBody(req);
        const msg = JSON.parse(raw) as JsonRpcReq;
        send(res, 200, await handleRpc(orch, msg));
        return;
      }
      send(res, 404, { ok: false, error: { code: "invalid_argument", message: "not found", retryable: false } });
    } catch (err) {
      send(res, 500, {
        ok: false,
        error: {
          code: "dependency_unavailable",
          message: err instanceof Error ? err.message : "error",
          retryable: true,
        },
      });
    }
  });
}

export async function serveStdio(orch: Orchestrator): Promise<void> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as JsonRpcReq;
      const out = await handleRpc(orch, msg);
      process.stdout.write(`${JSON.stringify(out)}\n`);
    } catch (err) {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: err instanceof Error ? err.message : "parse" } })}\n`,
      );
    }
  }
}
