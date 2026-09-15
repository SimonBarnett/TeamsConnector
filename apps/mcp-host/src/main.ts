import { composeFromEnv } from "./compose.ts";
import { createHttpServer, serveStdio } from "./server.ts";

const { orch } = await composeFromEnv();
const transport = process.env.MCP_TRANSPORT ?? "stdio";

if (transport === "http") {
  const port = Number(process.env.MCP_HTTP_PORT ?? 8787);
  const server = createHttpServer(orch);
  server.listen(port, () => {
    process.stderr.write(`teams-audio-join MCP HTTP listening on ${port}\n`);
  });
} else {
  await serveStdio(orch);
}
