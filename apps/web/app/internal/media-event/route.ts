import { nextToMcp } from "../../../src/dispatch.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(req: Request) {
  return nextToMcp(req, "/internal/media-event");
}
