import { nextToMcp } from "../../src/dispatch.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(req: Request) {
  return nextToMcp(req, "/health");
}
