# Host MCP at mcp-teams.ntsa.uk (AWS Amplify)

Amplify runs the **Node MCP HTTP** app (`POST /mcp`, `GET /ready`). It does **not** run the Windows media worker. Graph `playPrompt` still needs a public worker URL (`MEDIA_WORKER_URL` / `PUBLIC_BASE_URL`).

## 1. Amplify app (console)

This machine has no AWS CLI. Create the app in the AWS console:

1. Open [https://console.aws.amazon.com/amplify](https://console.aws.amazon.com/amplify) on **Azure subscription is unrelated** — use the AWS account that will own `ntsa.uk`.
2. **Create new app** → **GitHub** → `SimonBarnett/TeamsConnector` → branch `main`.
3. App name: `mcp-teams`.
4. Framework: **Next.js** (SSR / compute). Monorepo: app root can stay repo root; build uses `amplify.yml`.
5. **Environment variables** (copy from local `.env`, never commit secrets):

| Key | Notes |
|---|---|
| `NODE_ENV` | `production` |
| `MCP_TRANSPORT` | `http` |
| `AZURE_TENANT_ID` | Entra |
| `AZURE_CLIENT_ID` | |
| `AZURE_CLIENT_SECRET` | |
| `GRAPH_USER_ID` | |
| `ARTIFACT_ENCRYPTION_KEY` | 32-byte base64 |
| `MEDIA_WORKER_URL` | **Public** HTTPS of the worker, not `127.0.0.1` |
| `MEDIA_WORKER_SECRET` | if set |
| `DATABASE_URL` | required in production if you want sessions to survive |
| `DEMO_FIXTURE` | `0` |
| `TRANSCRIPT_POLL_MS` | `15000` |
| `XAI_API_KEY` | optional |

6. Save and deploy. First URL is `https://main.xxxx.amplifyapp.com`.

## 2. Custom domain mcp-teams.ntsa.uk

1. Amplify app → **Hosting** → **Custom domains** → **Add domain**.
2. Domain: `ntsa.uk` (or add subdomain only if Amplify asks).
3. Subdomain: `mcp-teams` → HTTPS (Amplify-managed cert).
4. Amplify shows a **CNAME** (and maybe a domain verification CNAME).
5. In **ntsa.uk DNS** (wherever that zone lives — Cloudflare, Route 53, registrar):

```
mcp-teams  CNAME  <amplify-given-target>
```

TTL 300 until it works. Wait for SSL **Available**.

6. Hit `https://mcp-teams.ntsa.uk/ready` then `POST https://mcp-teams.ntsa.uk/mcp`.

## 3. Grok / MCP client

Point the MCP HTTP endpoint at `https://mcp-teams.ntsa.uk/mcp`.

## 4. What still stays off Amplify

- `services/media-worker` (.NET, Graph calling, `/prompts/{guid}.wav`)
- Cloudflare named tunnel **or** Azure App Service for `PUBLIC_BASE_URL` / `CALLBACK_URI`
- Entra app, Speech key, Teams calling bot
