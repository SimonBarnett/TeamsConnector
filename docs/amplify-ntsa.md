# Host MCP at mcp-teams.ntsa.uk (AWS Amplify)

Amplify runs the **Node MCP HTTP** app (`POST /mcp`, `GET /ready`). It does **not** run the Windows media worker. Graph `playPrompt` still needs a public worker URL (`MEDIA_WORKER_URL` / `PUBLIC_BASE_URL`).

## 1. Amplify app (console)

AWS CLI is on this machine (`eu-west-2`). App id `dwn8q7r62chx6`, default domain `dwn8q7r62chx6.amplifyapp.com`.

1. Open [https://console.aws.amazon.com/amplify](https://console.aws.amazon.com/amplify) — Azure is unrelated; use the AWS account that already hosts `sim.ntsa.uk`.
2. App **mcp-teams.ntsa.uk** is WEB_COMPUTE (Next.js SSR). Source is currently CodeCommit `TeamsConnector` (GitHub connect needs a PAT).
3. Monorepo: `AMPLIFY_MONOREPO_APP_ROOT=apps/web`. Build spec is root `amplify.yml` (`applications.appRoot: apps/web`; `npm ci` from the workspace root).
4. **Environment variables** (copy from local `.env`, never commit secrets):

| Key | Notes |
|---|---|
| `AMPLIFY_MONOREPO_APP_ROOT` | `apps/web` |
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

5. First URL is `https://main.dwn8q7r62chx6.amplifyapp.com`.

## 2. Custom domain mcp-teams.ntsa.uk

1. Amplify app → **Hosting** → **Custom domains** → **Add domain**.
2. Domain: `ntsa.uk` (or add subdomain only if Amplify asks).
3. Subdomain: `mcp-teams` → HTTPS (Amplify-managed cert).
4. Amplify shows a **CNAME** (and maybe a domain verification CNAME).
5. In **ntsa.uk DNS** (Talk Internet nameservers — same panel as `sim.ntsa.uk`, not this account’s Route 53):

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
