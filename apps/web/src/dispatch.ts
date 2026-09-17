import { dispatchHttp } from "../../mcp-host/src/server.ts";
import { getComposed } from "./composed.ts";

export async function nextToMcp(req: Request, path: string): Promise<Response> {
  const { orch, httpHooks } = await getComposed();
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
