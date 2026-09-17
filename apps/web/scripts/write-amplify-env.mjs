import { writeFileSync } from "node:fs";

const keys = [
  "ARTIFACT_ENCRYPTION_KEY",
  "ASSISTANT_DISPLAY_NAME",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
  "AZURE_TENANT_ID",
  "DATABASE_URL",
  "DEMO_FIXTURE",
  "GRAPH_USER_ID",
  "LOG_LEVEL",
  "MCP_HTTP_SECRET",
  "MCP_TRANSPORT",
  "MEDIA_WORKER_ENABLED",
  "MEDIA_WORKER_URL",
  "NODE_ENV",
  "TRANSCRIPT_POLL_MS",
  "WORKFLOW_TRIGGER",
];

const env = Object.fromEntries(keys.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
writeFileSync(
  "src/runtime-env.ts",
  `export const amplifyEnv: Record<string, string> = ${JSON.stringify(env)};\n`,
);
process.stderr.write(`wrote src/runtime-env.ts (${Object.keys(env).length} keys)\n`);
