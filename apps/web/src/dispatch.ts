import { dispatchHttp } from "../../mcp-host/src/server.ts";
import { getComposed } from "./composed.ts";

export async function nextToMcp(req: Request, path: string): Promise<Response> {
  let orch: Awaited<ReturnType<typeof getComposed>>["orch"];
  let httpHooks: Awaited<ReturnType<typeof getComposed>>["httpHooks"];
  try {
    ({ orch, httpHooks } = await getComposed());
  } catch (err) {
    const message = err instanceof Error ? err.message : "compose failed";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
  const forwarded = req.headers.get("x-forwarded-for") ?? undefined;
  const result = await dispatchHttp(orch, httpHooks, {
    method: req.method,
    url: `${path}${url.search}`,
    headers,
    body,
    remoteAddr: forwarded?.split(",")[0]?.trim(),
  });
  return new Response(result.body, { status: result.status, headers: result.headers });
}
