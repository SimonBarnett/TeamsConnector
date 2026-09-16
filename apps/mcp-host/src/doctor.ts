import { PgStore } from "@teams-audio-join/store";
import type { HostConfig } from "./env.ts";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  mode: HostConfig["mode"];
  checks: DoctorCheck[];
}

export async function runDoctor(cfg: HostConfig, opts?: { graphProbe?: () => Promise<boolean> }): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const nodeMaj = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node",
    ok: nodeMaj >= 22,
    detail: `node ${process.versions.node} (need >= 22)`,
  });
  checks.push({
    name: "encryption",
    ok: cfg.nodeEnv !== "production" || Boolean(cfg.encryptionKey),
    detail: cfg.encryptionKey ? "ARTIFACT_ENCRYPTION_KEY set" : "dev fallback key (not for production)",
  });

  if (cfg.databaseUrl) {
    const up = await PgStore.ping(cfg.databaseUrl);
    checks.push({
      name: "postgres",
      ok: up,
      detail: up ? "DATABASE_URL reachable — PgStore" : "DATABASE_URL set but SELECT 1 failed",
    });
  } else {
    checks.push({
      name: "postgres",
      ok: true,
      detail: "unset — in-memory store (lost on restart). Fine for local.",
    });
  }

  if (cfg.azure) {
    let graphOk = true;
    let graphDetail = `app ${cfg.azure.clientId} user ${cfg.azure.graphUserId}`;
    if (opts?.graphProbe) {
      try {
        graphOk = await opts.graphProbe();
        graphDetail += graphOk ? " (token/probe ok)" : " (probe failed — check application access policy; Graph 404 looks like meeting_not_found)";
      } catch (err) {
        graphOk = false;
        graphDetail += ` (${err instanceof Error ? err.message : "probe error"})`;
      }
    } else {
      graphDetail += " (no live probe)";
    }
    checks.push({ name: "graph", ok: graphOk, detail: graphDetail });
  } else {
    checks.push({
      name: "graph",
      ok: true,
      detail: "fixture FakeGraph — not a real tenant",
    });
  }

  if (!cfg.mediaEnabled) {
    checks.push({ name: "media", ok: true, detail: "MEDIA_WORKER_ENABLED=false — notes only, cannot speak" });
  } else if (cfg.mode === "fixture-loopback") {
    checks.push({
      name: "media",
      ok: true,
      detail: "loopback — speak() works in this process, humans in Teams will not hear it",
    });
  } else if (cfg.mediaWorkerUrl) {
    let ok = false;
    let detail = cfg.mediaWorkerUrl;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 3000);
      const res = await fetch(`${cfg.mediaWorkerUrl.replace(/\/$/, "")}/health`, { signal: ac.signal });
      clearTimeout(t);
      ok = res.ok;
      detail += ` HTTP ${res.status}`;
    } catch (err) {
      detail += ` (${err instanceof Error ? err.message : "unreachable"})`;
    }
    checks.push({
      name: "media",
      ok,
      detail: `${detail}. Host uses HttpMediaWorker (Path A playPrompt). healthy=true only if worker has Graph + Azure Speech TTS.`,
    });
  } else {
    checks.push({
      name: "media",
      ok: false,
      detail: "Graph is configured but MEDIA_WORKER_URL is empty. Real Teams will not hear the assistant. Set the Windows worker URL or MEDIA_WORKER_ENABLED=false for notes-only.",
    });
  }

  checks.push({
    name: "summarizer",
    ok: true,
    detail: cfg.xaiKey ? "XAI_API_KEY set" : "fixture summarizer (no XAI_API_KEY)",
  });

  if (cfg.calendarUrl) {
    checks.push({ name: "calendar", ok: true, detail: cfg.calendarUrl });
  } else {
    checks.push({ name: "calendar", ok: true, detail: "unset — FakeCalendar / no trigger" });
  }

  if (cfg.unknownKeys.length) {
    checks.push({
      name: "env",
      ok: false,
      detail: `unknown keys (typo?): ${cfg.unknownKeys.join(", ")}`,
    });
  } else {
    checks.push({ name: "env", ok: true, detail: "no unknown TEAMS_/AZURE_/MCP_ keys" });
  }

  return { ok: checks.every((c) => c.ok), mode: cfg.mode, checks };
}

export function formatDoctor(report: DoctorReport): string {
  const lines = [`mode=${report.mode} ready=${report.ok ? "yes" : "no"}`];
  for (const c of report.checks) {
    lines.push(`${c.ok ? "ok " : "FAIL"} ${c.name}: ${c.detail}`);
  }
  return lines.join("\n");
}
