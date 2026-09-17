import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { listedMcpTools, type Envelope } from "@teams-audio-join/shared";
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

function header(headers: Record<string, string | string[] | undefined>, name: string): string {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v.join(",");
  return v ?? "";
}

function wantsJson(url: string, headers: Record<string, string | string[] | undefined>): boolean {
  if (/[?&]format=json(?:&|$)/.test(url)) return true;
  const accept = header(headers, "accept");
  if (accept.includes("text/html")) return false;
  return accept.includes("application/json");
}

export interface HttpDispatchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function dispatchHttp(
  orch: Orchestrator,
  hooks: HostHttpHooks | undefined,
  input: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
    remoteAddr?: string;
  },
): Promise<HttpDispatchResult> {
  const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
  const htmlHeaders = { "content-type": "text/html; charset=utf-8" };
  const pack = (status: number, headers: Record<string, string>, body: string): HttpDispatchResult => ({
    status,
    headers,
    body,
  });
  const json = (status: number, body: unknown) => pack(status, jsonHeaders, JSON.stringify(body));
  try {
    const path = normalizePath(input.url);
    const method = input.method || "GET";
    if (method === "GET" && (path === "/" || path === "/mcp")) {
      if (!wantsJson(input.url, input.headers)) {
        return pack(200, htmlHeaders, landingHtml(Boolean(hooks?.production)));
      }
      return json(200, landingPayload());
    }
    if (method === "GET" && (path === "/health" || path === "/ready")) {
      if (hooks?.doctor && path === "/ready") {
        const report = await hooks.doctor();
        if (!wantsJson(input.url, input.headers)) {
          const rows = report.checks
            .map((c) => `<li class="${c.ok ? "ok" : "fail"}"><strong>${c.name}</strong> — ${c.detail}</li>`)
            .join("");
          return pack(
            report.ok ? 200 : 503,
            htmlHeaders,
            htmlPage("ready", `<p><a href="/">Home</a></p><h1>mode=${report.mode} ready=${report.ok ? "yes" : "no"}</h1><ul>${rows}</ul>`),
          );
        }
        return json(report.ok ? 200 : 503, report);
      }
      return json(200, { ok: true });
    }
    if (method === "GET" && path === "/metrics") {
      return pack(200, { "content-type": "text/plain; version=0.0.4" }, orch.metrics.renderPrometheus());
    }
    if (method === "POST" && path === "/internal/media-event") {
      const auth = header(input.headers, "authorization");
      const allowed = hooks?.mediaSecret
        ? auth === `Bearer ${hooks.mediaSecret}`
        : isLoopbackAddr(input.remoteAddr);
      if (!allowed) {
        return json(401, { ok: false, error: { code: "unauthenticated", message: "media-event unauthorized", retryable: false } });
      }
      const body = JSON.parse(input.body || "{}") as { sessionId?: string; event?: string };
      if (body.sessionId && (body.event === "ejected" || body.event === "established")) {
        await orch.handleMediaEvent(body.sessionId, body.event);
      }
      return json(200, { ok: true });
    }
    if (method === "POST" && (path === "/mcp" || path === "/")) {
      if (hooks?.mcpSecret) {
        if (!bearerMatches(header(input.headers, "authorization"), hooks.mcpSecret)) {
          return json(401, {
            ok: false,
            error: { code: "unauthenticated", message: "mcp unauthorized", retryable: false },
          });
        }
      } else if (hooks?.production) {
        return json(401, {
          ok: false,
          error: { code: "unauthenticated", message: "mcp unauthorized", retryable: false },
        });
      }
      const msg = JSON.parse(input.body || "{}") as JsonRpcReq;
      return json(
        200,
        await handleRpc(orch, msg, {
          includeWorkflows: hooks?.includeWorkflows,
          defaultMeta: hooks?.defaultMeta,
        }),
      );
    }
    return json(404, {
      ok: false,
      error: {
        code: "invalid_argument",
        message: `${method} ${path} is not a route. Use GET /ready or POST /mcp.`,
        retryable: false,
      },
    });
  } catch (err) {
    return json(500, {
      ok: false,
      error: {
        code: "dependency_unavailable",
        message: err instanceof Error ? err.message : "error",
        retryable: true,
      },
    });
  }
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

export interface DefaultCallMeta {
  tenantId: string;
  userId: string;
  agentId: string;
  meetingConfirmed: boolean;
}

export interface HostHttpHooks {
  doctor?: () => Promise<DoctorReport>;
  includeWorkflows?: boolean;
  production?: boolean;
  mediaSecret?: string;
  mcpSecret?: string;
  defaultMeta?: DefaultCallMeta;
}

export interface RpcOpts {
  includeWorkflows?: boolean;
  defaultMeta?: DefaultCallMeta;
}

const CALL_META_KEYS = [
  "tenantId",
  "userId",
  "agentId",
  "requestId",
  "idempotencyKey",
  "meetingConfirmed",
  "confirmStanding",
] as const;

/** Grok HTTP MCP sends `_meta.progressToken`, not CallMeta. Fill the seeded tenant when those fields are absent. */
export function mergeCallMeta(raw: unknown, defaults?: DefaultCallMeta): unknown {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const picked: Record<string, unknown> = {};
  for (const k of CALL_META_KEYS) {
    if (obj[k] !== undefined) picked[k] = obj[k];
  }
  if (!defaults) return Object.keys(picked).length ? picked : obj;
  return {
    tenantId: picked.tenantId ?? defaults.tenantId,
    userId: picked.userId ?? defaults.userId,
    agentId: picked.agentId ?? defaults.agentId,
    meetingConfirmed: picked.meetingConfirmed ?? defaults.meetingConfirmed,
    ...(picked.requestId !== undefined ? { requestId: picked.requestId } : {}),
    ...(picked.idempotencyKey !== undefined ? { idempotencyKey: picked.idempotencyKey } : {}),
    ...(picked.confirmStanding !== undefined ? { confirmStanding: picked.confirmStanding } : {}),
  };
}

function bearerMatches(authorization: string, secret: string): boolean {
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix) || !secret) return false;
  const got = Buffer.from(authorization.slice(prefix.length));
  const want = Buffer.from(secret);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

export async function handleRpc(orch: Orchestrator, msg: JsonRpcReq, opts?: RpcOpts): Promise<unknown> {
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
        tools: listedMcpTools({ includeWorkflows: Boolean(opts?.includeWorkflows) }),
      },
    };
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name ?? "";
    const args = msg.params?.arguments ?? {};
    const meta = mergeCallMeta(msg.params?.meta ?? msg.params?._meta ?? {}, opts?.defaultMeta);
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

function landingHtml(production: boolean): string {
  const fixtureButtons = production
    ? ""
    : `<button type="button" id="join">Join fixture meeting</button>
  <button type="button" id="speak">Speak</button>`;
  const fixtureScript = production
    ? ""
    : `document.getElementById("join").onclick = async () => {
  const json = await rpc("tools/call", {
    name: "join_meeting",
    arguments: { onlineMeetingId: "om-priority", mode: "listen_speak", announce: false },
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
};`;
  return htmlPage("teams-audio-join", `
<h1>teams-audio-join</h1>
<p>MCP JSON-RPC host. Browsers cannot POST from the address bar — use the buttons or <a href="/ready">/ready</a>.</p>
${production ? "<p>Production HTTP: fixture Join/Speak controls are hidden.</p>" : ""}
<div class="row">
  <a href="/ready">Doctor /ready</a>
  <a href="/health">/health</a>
  <a href="/metrics">/metrics</a>
</div>
<div class="row">
  <button type="button" id="list">List tools</button>
  ${fixtureButtons}
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
${fixtureScript}
</script>`);
}

function isLoopbackAddr(addr: string | undefined): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === ":ffff:127.0.0.1" || addr === "::ffff:127.0.0.1";
}

export function createHttpServer(
  orch: Orchestrator,
  hooks?: HostHttpHooks,
) {
  return createServer(async (req, res) => {
    const dispatched = await dispatchHttp(orch, hooks, {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req),
      remoteAddr: req.socket.remoteAddress,
    });
    res.writeHead(dispatched.status, dispatched.headers);
    res.end(dispatched.body);
  });
}

function writeStdioFrame(msg: unknown): void {
  const json = Buffer.from(JSON.stringify(msg), "utf8");
  process.stdout.write(`Content-Length: ${json.length}\r\n\r\n`);
  process.stdout.write(json);
}

export async function serveStdio(orch: Orchestrator, opts?: RpcOpts): Promise<void> {
  let buf = Buffer.alloc(0);
  process.stdin.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    void drainStdio(orch);
  });
  await new Promise<void>((resolve) => {
    process.stdin.on("end", () => resolve());
    process.stdin.resume();
  });

  async function drainStdio(o: Orchestrator): Promise<void> {
    while (true) {
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buf.subarray(0, headerEnd).toString("utf8");
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (!m) {
        buf = buf.subarray(headerEnd + 4);
        writeStdioFrame({ jsonrpc: "2.0", error: { code: -32700, message: "missing Content-Length" } });
        continue;
      }
      const len = Number(m[1]);
      const start = headerEnd + 4;
      if (buf.length < start + len) return;
      const body = buf.subarray(start, start + len).toString("utf8");
      buf = buf.subarray(start + len);
      try {
        const msg = JSON.parse(body) as JsonRpcReq;
        writeStdioFrame(await handleRpc(o, msg, opts));
      } catch (err) {
        writeStdioFrame({
          jsonrpc: "2.0",
          error: { code: -32700, message: err instanceof Error ? err.message : "parse" },
        });
      }
    }
  }
}
