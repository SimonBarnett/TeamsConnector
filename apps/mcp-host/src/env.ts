import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const KNOWN_ENV = [
  "NODE_ENV",
  "MCP_TRANSPORT",
  "MCP_HTTP_PORT",
  "LOG_LEVEL",
  "DEMO_FIXTURE",
  "DEMO_TENANT_ID",
  "DEMO_USER_ID",
  "ARTIFACT_ENCRYPTION_KEY",
  "DATABASE_URL",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_CLIENT_CERTIFICATE",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
  "GRAPH_USER_ID",
  "ASSISTANT_DISPLAY_NAME",
  "XAI_API_KEY",
  "XAI_BASE_URL",
  "XAI_MODEL",
  "EVENT_WEBHOOK_URL",
  "EVENT_WEBHOOK_SECRET",
  "MEDIA_WORKER_URL",
  "MEDIA_WORKER_ENABLED",
  "MEDIA_WORKER_SECRET",
  "CALENDAR_CONNECTOR_URL",
  "WORKFLOW_TRIGGER",
  "TRANSCRIPT_POLL_MS",
] as const;

export type KnownEnv = (typeof KNOWN_ENV)[number];

export interface HostConfig {
  nodeEnv: string;
  transport: "stdio" | "http";
  httpPort: number;
  demo: boolean;
  encryptionKey?: string;
  databaseUrl?: string;
  azure?: {
    tenantId: string;
    clientId: string;
    clientSecret?: string;
    clientCertificate?: string;
    graphUserId: string;
  };
  mediaWorkerSecret?: string;
  assistantDisplayName: string;
  xaiKey?: string;
  xaiBaseUrl?: string;
  xaiModel?: string;
  webhook?: { url: string; secret: string };
  mediaEnabled: boolean;
  mediaWorkerUrl?: string;
  calendarUrl?: string;
  workflowTrigger: boolean;
  pollMs: number;
  unknownKeys: string[];
  /** fixture-loopback | graph-notes-only | graph-waiting-for-worker */
  mode: "fixture-loopback" | "graph-notes-only" | "graph-waiting-for-worker";
}

export function loadDotenv(cwd = process.cwd()): string[] {
  const file = resolve(cwd, ".env");
  if (!existsSync(file)) return [];
  const loaded: string[] = [];
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
      loaded.push(key);
    }
  }
  return loaded;
}

export function parseHostConfig(env: NodeJS.ProcessEnv = process.env): HostConfig {
  const unknownKeys = Object.keys(env).filter(
    (k) => k.startsWith("TEAMS_") || k.startsWith("MCP_") || k.startsWith("AZURE_") || k.startsWith("XAI_") || k.startsWith("GRAPH_") || k.startsWith("MEDIA_") || k.startsWith("CALENDAR_") || k.startsWith("ARTIFACT_") || k.startsWith("DATABASE_") || k.startsWith("EVENT_") || k.startsWith("WORKFLOW_") || k.startsWith("TRANSCRIPT_") || k.startsWith("DEMO_") || k.startsWith("ASSISTANT_")
  ).filter((k) => !(KNOWN_ENV as readonly string[]).includes(k));

  const nodeEnv = env.NODE_ENV ?? "development";
  const hasGraph = Boolean(
    env.AZURE_CLIENT_ID &&
      env.AZURE_TENANT_ID &&
      env.GRAPH_USER_ID &&
      (env.AZURE_CLIENT_SECRET || env.AZURE_CLIENT_CERTIFICATE),
  );
  const mediaEnabled = env.MEDIA_WORKER_ENABLED !== "false";
  const demo = env.DEMO_FIXTURE === "1" || (!hasGraph && nodeEnv !== "production");

  let mode: HostConfig["mode"] = "fixture-loopback";
  if (hasGraph && mediaEnabled && env.MEDIA_WORKER_URL) mode = "graph-waiting-for-worker";
  else if (hasGraph) mode = "graph-notes-only";
  else mode = "fixture-loopback";

  const cfg: HostConfig = {
    nodeEnv,
    transport: env.MCP_TRANSPORT === "http" ? "http" : "stdio",
    httpPort: Number(env.MCP_HTTP_PORT ?? 8787),
    demo,
    assistantDisplayName: env.ASSISTANT_DISPLAY_NAME || "Haitch (audio assistant)",
    mediaEnabled,
    workflowTrigger: env.WORKFLOW_TRIGGER === "1" || env.WORKFLOW_TRIGGER === "true",
    pollMs: Number(env.TRANSCRIPT_POLL_MS ?? (hasGraph ? 15000 : 0)),
    unknownKeys,
    mode,
  };
  if (env.ARTIFACT_ENCRYPTION_KEY) cfg.encryptionKey = env.ARTIFACT_ENCRYPTION_KEY;
  if (env.DATABASE_URL) cfg.databaseUrl = env.DATABASE_URL;
  if (hasGraph) {
    cfg.azure = {
      tenantId: env.AZURE_TENANT_ID!,
      clientId: env.AZURE_CLIENT_ID!,
      graphUserId: env.GRAPH_USER_ID!,
    };
    if (env.AZURE_CLIENT_SECRET) cfg.azure.clientSecret = env.AZURE_CLIENT_SECRET;
    if (env.AZURE_CLIENT_CERTIFICATE) cfg.azure.clientCertificate = env.AZURE_CLIENT_CERTIFICATE;
  }
  if (env.MEDIA_WORKER_SECRET) cfg.mediaWorkerSecret = env.MEDIA_WORKER_SECRET;
  if (env.XAI_API_KEY) cfg.xaiKey = env.XAI_API_KEY;
  if (env.XAI_BASE_URL) cfg.xaiBaseUrl = env.XAI_BASE_URL;
  if (env.XAI_MODEL) cfg.xaiModel = env.XAI_MODEL;
  if (env.EVENT_WEBHOOK_URL && env.EVENT_WEBHOOK_SECRET) {
    cfg.webhook = { url: env.EVENT_WEBHOOK_URL, secret: env.EVENT_WEBHOOK_SECRET };
  }
  if (env.MEDIA_WORKER_URL) cfg.mediaWorkerUrl = env.MEDIA_WORKER_URL;
  if (env.CALENDAR_CONNECTOR_URL) cfg.calendarUrl = env.CALENDAR_CONNECTOR_URL;
  return cfg;
}

export function encryptionKeyEntropyOk(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

export function assertHostConfig(cfg: HostConfig): void {
  if (cfg.nodeEnv === "production" && !cfg.encryptionKey) {
    throw new Error("ARTIFACT_ENCRYPTION_KEY is required in production (32-byte key, base64).");
  }
  if (cfg.nodeEnv === "production" && !encryptionKeyEntropyOk(cfg.encryptionKey)) {
    throw new Error("ARTIFACT_ENCRYPTION_KEY must decode to 32 bytes.");
  }
  if (cfg.nodeEnv === "production" && cfg.mode === "fixture-loopback") {
    throw new Error("Production cannot run fixture-loopback. Set AZURE_* and GRAPH_USER_ID.");
  }
}
