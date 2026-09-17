import { composeFromEnv, type Composed } from "../../mcp-host/src/compose.ts";
import { amplifyEnv } from "./runtime-env.ts";

let cached: Promise<Composed> | undefined;

export function getComposed(): Promise<Composed> {
  cached ??= composeFromEnv({ ...process.env, ...amplifyEnv });
  return cached;
}
