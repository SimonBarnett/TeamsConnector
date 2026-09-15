import { loadDotenv } from "./env.ts";
import { formatDoctor } from "./doctor.ts";
import { composeFromEnv } from "./compose.ts";
import { createHttpServer, serveStdio } from "./server.ts";

loadDotenv();
const { orch, cfg, doctor, banner } = await composeFromEnv();
process.stderr.write(`${banner}\n`);

if (process.argv.includes("doctor") || process.env.MCP_DOCTOR === "1") {
  const report = await doctor();
  process.stderr.write(`${formatDoctor(report)}\n`);
  process.exit(report.ok ? 0 : 1);
}

if (cfg.transport === "http") {
  const server = createHttpServer(orch, { doctor });
  server.listen(cfg.httpPort, () => {
    process.stderr.write(`MCP HTTP :${cfg.httpPort}  GET /ready for doctor\n`);
  });
} else {
  await serveStdio(orch);
}
