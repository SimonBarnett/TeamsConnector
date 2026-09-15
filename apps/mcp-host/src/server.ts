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
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

function wantsJson(req: IncomingMessage): boolean {
  const url = req.url ?? "";
  if (/[?&]format=json(?:&|$)/.test(url)) return true;
  const accept = req.headers.accept ?? "";
  if (accept.includes("text/html")) return false;
  return accept.includes("application/json");
}

function landingPayload() {
  return {
    ok: true,
    service: "teams-audio-join",
    hint: "This is an MCP JSON-RPC server. Open /ready in the browser. POST JSON-RPC to /mcp.",
    endpoints: {
      ready: "GET /ready",
      health: "GET /health",
      metrics: "GET /metrics",
      mcp: "POST /mcp",
    },
    example: {
      method: "POST",
      url: "/mcp",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    },
  };
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <style>
    body { font: 15px/1.45 system-ui, sans-serif; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; color: #1a1224; }
    a { color: #5B2C6F; }
    pre, textarea { background: #f6f2f8; padding: 0.75rem; overflow: auto; border-radius: 6px; width: 100%; box-sizing: border-box; }
    button { background: #5B2C6F; color: #fff; border: 0; padding: 0.45rem 0.8rem; border-radius: 6px; cursor: pointer; }
    .row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 0.75rem 0; }
    .ok { color: #0a7; } .fail { color: #c22; }
  </style>
</head>
<body>${body}</body>
</html>`;
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

function normalizePath(url: string | undefined): string {
  const raw = (url ?? "/").split("?")[0] || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw;
}

export function createHttpServer(
  orch: Orchestrator,
  hooks?: { doctor?: () => Promise<DoctorReport> },
) {
  return createServer(async (req, res) => {
    try {
      const path = normalizePath(req.url);
      const method = req.method ?? "GET";
      if (method === "GET" && (path === "/" || path === "/mcp")) {
        if (!wantsJson(req)) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(htmlPage("teams-audio-join", `
<h1>teams-audio-join</h1>
<p>MCP JSON-RPC host. Browsers cannot POST from the address bar — use the buttons or <a href="/ready">/ready</a>.</p>
<div class="row">
  <a href="/ready">Doctor /ready</a>
  <a href="/health">/health</a>
  <a href="/metrics">/metrics</a>
</div>
<div class="row">
  <button type="button" id="list">List tools</button>
  <button type="button" id="join">Join fixture meeting</button>
  <button type="button" id="speak">Speak</button>
</div>
<pre id="out">Click List tools to call POST /mcp.</pre>
<script>
const meta = {
  tenantId: "11111111-2222-3333-4444-555555555555",
  userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  agentId: "haitch",
  meetingConfirmed: true
};
let sessionId = "";
const out = document.getElementById("out");
async function rpc(method, params) {
  const res = await fetch("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
  });
  const json = await res.json();
  out.textContent = JSON.stringify(json, null, 2);
  return json;
}
document.getElementById("list").onclick = () => rpc("tools/list");
document.getElementById("join").onclick = async () => {
  const json = await rpc("tools/call", {
    name: "join_meeting",
    arguments: { onlineMeetingId: "om-priority", announce: false },
    meta
  });
  try {
    const env = JSON.parse(json.result.content[0].text);
    sessionId = env.data && env.data.sessionId || "";
  } catch {}
};
document.getElementById("speak").onclick = () => {
  if (!sessionId) { out.textContent = "Join first."; return; }
  rpc("tools/call", {
    name: "speak",
    arguments: { sessionId, text: "Hello team, the local demo is running." },
    meta
  });
};
</script>`));
          return;
        }
        send(res, 200, landingPayload());
        return;
      }
      if (method === "GET" && (path === "/health" || path === "/ready")) {
        if (hooks?.doctor && path === "/ready") {
          const report = await hooks.doctor();
          if (!wantsJson(req)) {
            const rows = report.checks
              .map((c) => `<li class="${c.ok ? "ok" : "fail"}"><strong>${c.name}</strong> — ${c.detail}</li>`)
              .join("");
            res.writeHead(report.ok ? 200 : 503, { "content-type": "text/html; charset=utf-8" });
            res.end(htmlPage("ready", `<p><a href="/">Home</a></p><h1>mode=${report.mode} ready=${report.ok ? "yes" : "no"}</h1><ul>${rows}</ul>`));
            return;
          }
          send(res, report.ok ? 200 : 503, report);
          return;
        }
        send(res, 200, { ok: true });
        return;
      }
      if (method === "GET" && path === "/metrics") {
        res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
        res.end(orch.metrics.renderPrometheus());
        return;
      }
      if (method === "POST" && (path === "/mcp" || path === "/")) {
        const raw = await readBody(req);
        const msg = JSON.parse(raw) as JsonRpcReq;
        send(res, 200, await handleRpc(orch, msg));
        return;
      }
      send(res, 404, {
        ok: false,
        error: {
          code: "invalid_argument",
          message: `${method} ${path} is not a route. Use GET /ready or POST /mcp.`,
          retryable: false,
        },
      });
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
