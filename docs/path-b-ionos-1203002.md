# Path B on IONOS — 500#1203002 (2026-09-18)

**Box:** `WIN-MPRE8VI4U6U` (IONOS Windows L). Media-host only.  
**Public:** `rtp-teams.ntsa.uk` → `217.154.57.228`. Graph callback `https://rtp-teams.ntsa.uk/callback` (IIS ARR → `http://127.0.0.1:7072`). Media TCP **8445**.  
**Do not:** walrus, Amplify `plane=auto`, Club Madeira IIS SNI (`*.clubmadeira.io` SSL bindings), print `.env` / `AZURE_CLIENT_SECRET` / `AZURE_SPEECH_KEY` / `MEDIA_WORKER_SECRET`.  
**Goal that did not land:** application-hosted media (`Calls.AccessMedia.All`) — RTP PCM → Azure STT and TTS PCM. `plane=auto` stays **off**.

This document is the handoff from the IONOS session. Path A (service-hosted `playPrompt` + Track A transcripts) is unchanged; see `spike-track-b.md`.

## Verdict

Graph **joins** (admit 200) and **notifications work**. Microsoft’s media cloud then **terminates the call in ~1s** with:

```
changeType=updated  state=establishing
changeType=deleted  state=terminated  resultCode=500  resultSubcode=1203002
DiagCode: 500#1203002  Server Internal Error
```

`ICall` matches: `Establishing` then `Terminated` same second. Never `established`. Teams **does** TCP-connect to `217.154.57.228:8445` from `52.112.x` (Skype media). Amplify `POST /leave` is **after** Graph hang-up, not the cause.

Microsoft’s published requirement for application-hosted media bots is a **Windows Server VM in Azure** (instance-level public IP, not NAT, not App Service). This IONOS VPS can run the host and accept TLS; the Skype media path still fails SSL/negotiate (`1203002`). **Another public CA on this box will not fix it.** Next host is Azure Windows IaaS with the same `services/media-host` build.

## What already works (do not regress)

| Piece | State |
|---|---|
| Git | `main` at `09505ea` (callback URI rebuild) plus this logging/cert-load commit |
| Task | `Bob-TeamsMediaHost` (SYSTEM). Publish dir `C:\TeamsConnector-publish\media-host`. Use `C:\Program Files\dotnet\dotnet.exe` only |
| `/health` | `mediaReady=true` `graph=true` `tts=true` `stt=true` `callback=https://rtp-teams.ntsa.uk/callback` `publicLoopback=false` |
| IIS ARR | `preserveHostHeader=true`. `rtp-teams.ntsa.uk:443` SNI only. Club Madeira hostname bindings **must stay** |
| Graph `/callback` | IIS `POST /callback` **202** from `Microsoft-Skype`. Host rewrites public HTTPS URI (`09505ea`) |
| Amplify | `dwn8q7r62chx6` `main` `eu-west-2`. `MEDIA_WORKER_URL=https://rtp-teams.ntsa.uk`. Live `MEDIA_WORKER_SECRET` matches **publish** `.env`, not necessarily repo `.env` |
| Firewall (Windows) | TCP 8445 in; UDP 49152–65279 in (`Bob Teams Media *`) |

## Code shipped in this commit

- `services/media-host/GraphCallFileLog.cs` — append-only log (default `graph-call.log` next to the DLL, or `GRAPH_CALL_LOG`). Records Graph notification **`changeType` + `state` + `resultCode`/`subcode`/`message` only**. No tokens, no full body, no `clientState`.
- `Program.cs` `/callback` buffers the body, logs those fields, rewinds, then `ProcessNotificationAsync`.
- `HostedMediaRuntime.OnCallUpdated` writes the same fields from `ICall.ResultInfo`.
- Trace listener → same file (`GraphLogger redirectToTrace`).
- Certificate load enumerates `LocalMachine\My` and wraps `new X509Certificate2(cert)` so the native Media SDK gets a real private-key handle (avoid `X509Store.Find` clones).

**Do not** call `MediaPlatform.Initialize` **and** `CommunicationsClientBuilder.SetMediaPlatformSettings` — double init throws `MediaPlatform was already created` and `/health` goes `mediaReady=false`. The builder already initializes.

## Experiments that did **not** clear 1203002

All admits below: IIS admit 200 → two `/callback` 202 → Graph `terminated` 1203002. TCP 8445 from `52.112.x` ESTABLISHED.

| When (UTC) | Session | Cert / TLS | Result |
|---|---|---|---|
| 20:46:31 | `ses_01M2V4AJZ7X3HX1JHPXMNNX8F3` | LE RSA **3072**, issuer **YR1**, CSP SChannel `AT_KEYEXCHANGE` | 1203002. Orchestrator `/leave` 2s later |
| 21:01:14 | `ses_01M2V55HG2BX5HBGC2C31TJ9MD` | same (after callback logging) | 1203002. 8445 inbound `52.112.103.46` |
| 21:12:03 | `ses_01M2V5SBG9567N21NG3EM7JW4D` | LE RSA **2048**, issuer **YR2** → Root YR → ISRG X1 | 1203002. LE will not issue classic R10/R11 in 2026 |
| 21:42:35 | `ses_ionos_2240bst` | **ZeroSSL** RSA 2048, CA 2 → Sectigo **R46** | 1203002 |
| 21:49:57 | `ses_ionos_tls12_214955` | TLS **1.2** only on SChannel server; Azure RSA/ECC TLS issuing CAs installed; Kestrel **off** `:443` | 1203002 |
| 21:55:00 | `ses_ionos_usertrust_215458` | 8445 sends leaf → ZeroSSL CA 2 → R46 **cross-signed by USERTrust RSA** (R46 removed from AuthRoot/Root so SChannel does not stop at R46) | 1203002 |
| 22:00:54 | `ses_ionos_final_220052` | host restored after failed double-`Initialize` | 1203002 |

Also confirmed **not** the cause:

- Callback URL / ARR Host header (fixed at `09505ea`; Graph 202).
- Closed 8445 / missing Windows firewall (TCP connect succeeds).
- ECDSA / wrong CSP / `AT_SIGNATURE` / missing SYSTEM private-key ACL (ZeroSSL and LE were RSA, `Microsoft RSA SChannel Cryptographic Provider`, KeySpec 1, SYSTEM Full, encrypt test passed).
- Orchestrator hang-up (leave is after Graph `deleted`).

## Box TLS / IIS notes (keep)

- `MEDIA_HTTPS_PORT=0` — **do not** let Kestrel bind `0.0.0.0:443`. IIS/HTTP.sys owns `217.154.57.228:443` (rtp-teams + Club Madeira SNI).
- SChannel: TLS 1.2 Server/Client enabled; TLS 1.3 **Server** disabled (8445 default handshake is TLS 1.2 `ECDHE-RSA-AES256-GCM-SHA384`). IIS sites fall back to TLS 1.2.
- Machine store: Microsoft Azure RSA/ECC TLS Issuing CA 03/04/07/08 and older Azure TLS Issuing CA 01/02/05/06 in `LocalMachine\CA`.
- Sectigo R46 **self-signed was removed from AuthRoot/Root** so the ZeroSSL chain can include the USERTrust cross-sign. Windows Update may put R46 back; if it does, `openssl s_client -connect 217.154.57.228:8445 -showcerts` will drop cert #2 (R46→USERTrust).
- win-acme: `C:\ProgramData\Bob\win-acme\current`. LE renewal id `933a2p-lZECxGTNJCnBiHg`. ZeroSSL ACME `https://acme.zerossl.com/v2/DV90` has its own renewal. `settings.json` CSR RSA **2048** / SHA256. EAB lives in `C:\TeamsConnector\zerossl-eab.json` (not in git).

## How to read the next failure

On the host:

```text
C:\TeamsConnector-publish\media-host\graph-call.log
```

Success looks like `state=established` (and `ICall` `Established`). Failure is `resultSubcode=1203002` with no established line.

IIS `C:\inetpub\logs\LogFiles\W3SVC11\u_exYYMMDD.log`: `POST /admit`, `/callback`, `/leave`.

## Azure cutover (when Path B is retried)

1. Windows Server VM in Azure, instance public IP (not App Service, not NAT).
2. Copy `services/media-host` publish + `.env` (do not paste secrets on chat/IRC). New `MEDIA_PUBLIC_IP`, `MEDIA_SERVICE_FQDN`, `CALLBACK_URI`, `MEDIA_CERT_THUMBPRINT`.
3. RSA 2048, CSP `Microsoft RSA SChannel Cryptographic Provider`, `AT_KEYEXCHANGE`, SYSTEM ACL on the machine key. Prefer a CA Microsoft’s media trust store already has (DigiCert / classic ISRG X1). Serve the full intermediate chain.
4. TCP 8445 + UDP media range inbound. Graph notification URL public HTTPS.
5. Amplify `MEDIA_WORKER_URL` still `https://<that-fqdn>` only after `/health` is green. Do not point Amplify at Azure App Service Path A unless abandoning Path B.
6. Prove `graph-call.log` `established`, then a human phrase (e.g. `mirror-44`) on STT, **then** consider `plane=auto`.

## Secrets

Never commit `C:\TeamsConnector\.env`, `C:\TeamsConnector-publish\media-host\.env`, `pathb-secrets.env`, `zerossl-eab.json`. Publish `.env` `MEDIA_WORKER_SECRET` is the live Amplify value; repo `.env` may still hold an older local secret — do not copy repo over publish blindly.
