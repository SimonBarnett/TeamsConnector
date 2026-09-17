import { loadDotenv } from "./env.ts";
import { formatDoctor } from "./doctor.ts";
import { composeFromEnv } from "./compose.ts";
import { createHttpServer, serveStdio } from "./server.ts";

loadDotenv();
const { orch, cfg, doctor, banner, httpHooks } = await composeFromEnv();
process.stderr.write(`${banner}\n`);

if (process.argv.includes("doctor") || process.env.MCP_DOCTOR === "1") {
  const report = await doctor();
  process.stderr.write(`${formatDoctor(report)}\n`);
  process.exit(report.ok ? 0 : 1);
}

function onStop(signal: string): void {
  process.stderr.write(`${signal}: leaving live sessions\n`);
  void orch.shutdown().finally(() => process.exit(0));
}
process.on("SIGINT", () => onStop("SIGINT"));
process.on("SIGTERM", () => onStop("SIGTERM"));

if (cfg.transport === "http") {
  const server = createHttpServer(orch, httpHooks);
  server.listen(cfg.httpPort, () => {
    process.stderr.write(`MCP HTTP :${cfg.httpPort}  GET /ready for doctor\n`);
  });
} else {
  await serveStdio(orch, {
    includeWorkflows: httpHooks.includeWorkflows,
    defaultMeta: httpHooks.defaultMeta,
  });
}
