import { InMemoryStore, EnvelopeCipher } from "@teams-audio-join/store";
import { Orchestrator, MemoryEventSink, WebhookEventSink, LoopbackMediaWorker, UnavailableMediaWorker } from "@teams-audio-join/orchestrator";
import { FakeGraphClient, fixtureCatchup, GraphRestClient, ClientCredentialsTokenProvider } from "@teams-audio-join/graph";
import { FixtureLlmClient, XaiLlmClient, type LlmClient } from "@teams-audio-join/summarizer";
import { nowIso } from "@teams-audio-join/shared";
import { CalendarTrigger, FakeCalendar, HttpCalendarPort } from "@teams-audio-join/workflows";
import { assertHostConfig, parseHostConfig, type HostConfig } from "./env.ts";
import { runDoctor, type DoctorReport } from "./doctor.ts";

export interface Composed {
  cfg: HostConfig;
  orch: Orchestrator;
  doctor: () => Promise<DoctorReport>;
  banner: string;
}

export async function composeFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<Composed> {
  const cfg = parseHostConfig(env);
  assertHostConfig(cfg);

  const store = new InMemoryStore(EnvelopeCipher.fromEnv(cfg.encryptionKey));

  if (cfg.demo) {
    const tenantId = env.DEMO_TENANT_ID ?? "11111111-2222-3333-4444-555555555555";
    const userId = env.DEMO_USER_ID ?? "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await store.putTenant({
      tenantId,
      installedAt: nowIso(),
      trackAConsented: true,
      trackBConsented: cfg.mediaEnabled,
    });
    await store.putConnection({
      tenantId,
      userId,
      workAccountUpn: "demo@example.com",
      connectedAt: nowIso(),
    });
    await store.putAck({
      tenantId,
      userId,
      acknowledgedAt: nowIso(),
    });
  }

  const graph = cfg.azure
    ? new GraphRestClient(
        new ClientCredentialsTokenProvider({
          tenantId: cfg.azure.tenantId,
          clientId: cfg.azure.clientId,
          clientSecret: cfg.azure.clientSecret,
        }),
        cfg.azure.graphUserId,
      )
    : new FakeGraphClient([fixtureCatchup()]);

  let llm: LlmClient;
  if (cfg.xaiKey) {
    llm = new XaiLlmClient({
      apiKey: cfg.xaiKey,
      baseUrl: cfg.xaiBaseUrl,
      model: cfg.xaiModel,
    });
  } else {
    llm = new FixtureLlmClient({
      summary: "No XAI_API_KEY configured; returning a fixture summary.",
      decisions: [],
      actions: [],
      openQuestions: ["Configure XAI_API_KEY for grounded summaries."],
    });
  }

  const memory = new MemoryEventSink(
    cfg.webhook ? [new WebhookEventSink(cfg.webhook.url, cfg.webhook.secret)] : [],
  );

  // Production Graph without a worker must not pretend to talk (loopback is in-process only).
  const mediaWorker =
    !cfg.mediaEnabled || cfg.mode === "graph-notes-only"
      ? new UnavailableMediaWorker()
      : new LoopbackMediaWorker();

  const orch = new Orchestrator({
    store,
    graph,
    events: memory,
    llm,
    mediaWorker,
    assistantDisplayName: cfg.assistantDisplayName,
    pollMs: cfg.pollMs,
  });

  if (cfg.workflowTrigger) {
    const calendar = cfg.calendarUrl ? new HttpCalendarPort(cfg.calendarUrl) : new FakeCalendar();
    const tenantId = env.DEMO_TENANT_ID ?? "11111111-2222-3333-4444-555555555555";
    const userId = env.DEMO_USER_ID ?? "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const trigger = new CalendarTrigger({
      calendar,
      store,
      orch,
      events: memory,
      tenantId,
      userId,
      agentId: "haitch",
    });
    const timer = setInterval(() => {
      void trigger.tick();
    }, 60_000);
    timer.unref?.();
  }

  const doctor = () =>
    runDoctor(cfg, {
      graphProbe: cfg.azure
        ? async () => {
            const tok = new ClientCredentialsTokenProvider({
              tenantId: cfg.azure!.tenantId,
              clientId: cfg.azure!.clientId,
              clientSecret: cfg.azure!.clientSecret,
            });
            const token = await tok.getToken();
            return token.length > 0;
          }
        : undefined,
    });

  const banner = [
    `teams-audio-join mode=${cfg.mode}`,
    cfg.mode === "fixture-loopback" ? "speak() is local loopback; Teams attendees will not hear it" : "",
    cfg.mode === "graph-notes-only" ? "Graph is live; media worker missing — assistant cannot speak into Teams" : "",
    cfg.mode === "graph-waiting-for-worker" ? `Graph is live; MEDIA_WORKER_URL=${cfg.mediaWorkerUrl} (in-process loopback until createCall is wired)` : "",
    cfg.databaseUrl ? "WARNING: DATABASE_URL is set but store is still in-memory" : "store=memory",
    `summarizer=${cfg.xaiKey ? "xai" : "fixture"}`,
  ]
    .filter(Boolean)
    .join(" | ");

  return { cfg, orch, doctor, banner };
}
