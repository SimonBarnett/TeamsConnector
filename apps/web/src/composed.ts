import { composeFromEnv, type Composed } from "../../mcp-host/src/compose.ts";

let cached: Promise<Composed> | undefined;

export function getComposed(): Promise<Composed> {
  cached ??= composeFromEnv(process.env);
  return cached;
}
