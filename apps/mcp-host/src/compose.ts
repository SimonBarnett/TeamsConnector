import { InMemoryStore, EnvelopeCipher } from "@teams-audio-join/store";
import { Orchestrator, MemoryEventSink, WebhookEventSink } from "@teams-audio-join/orchestrator";
import { FakeGraphClient, fixtureCatchup, GraphRestClient, ClientCredentialsTokenProvider } from "@teams-audio-join/graph";
import { FixtureLlmClient, XaiLlmClient, type LlmClient } from "@teams-audio-join/summarizer";
import { nowIso } from "@teams-audio-join/shared";

export async function composeFromEnv(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === "production" && !env.ARTIFACT_ENCRYPTION_KEY) {
    throw new Error("ARTIFACT_ENCRYPTION_KEY is required in production");
  }
  const store = new InMemoryStore(EnvelopeCipher.fromEnv(env.ARTIFACT_ENCRYPTION_KEY));

  const demo = env.DEMO_FIXTURE === "1" || (!env.AZURE_CLIENT_ID && env.NODE_ENV !== "production");
  if (demo) {
    const tenantId = env.DEMO_TENANT_ID ?? "11111111-2222-3333-4444-555555555555";
    const userId = env.DEMO_USER_ID ?? "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await store.putTenant({
      tenantId,
      installedAt: nowIso(),
      trackAConsented: true,
      trackBConsented: false,
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

  const graph = env.AZURE_CLIENT_ID && env.AZURE_TENANT_ID && env.AZURE_CLIENT_SECRET && env.GRAPH_USER_ID
    ? new GraphRestClient(
        new ClientCredentialsTokenProvider({
          tenantId: env.AZURE_TENANT_ID,
          clientId: env.AZURE_CLIENT_ID,
          clientSecret: env.AZURE_CLIENT_SECRET,
        }),
        env.GRAPH_USER_ID,
      )
    : new FakeGraphClient([fixtureCatchup()]);

  let llm: LlmClient;
  if (env.XAI_API_KEY) {
    llm = new XaiLlmClient({
      apiKey: env.XAI_API_KEY,
      baseUrl: env.XAI_BASE_URL,
      model: env.XAI_MODEL,
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
    env.EVENT_WEBHOOK_URL && env.EVENT_WEBHOOK_SECRET
      ? [new WebhookEventSink(env.EVENT_WEBHOOK_URL, env.EVENT_WEBHOOK_SECRET)]
      : [],
  );

  const orch = new Orchestrator({
    store,
    graph,
    events: memory,
    llm,
    assistantDisplayName: env.ASSISTANT_DISPLAY_NAME,
  });

  return { store, orch, events: memory, graph };
}
