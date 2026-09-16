using System.Net;
using System.Net.Http.Headers;
using TeamsAudioJoin.MediaWorker;

var builder = WebApplication.CreateBuilder(args);
if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ASPNETCORE_URLS"))
    && !args.Any(a => a.StartsWith("--urls", StringComparison.OrdinalIgnoreCase)))
{
    builder.WebHost.UseUrls("http://127.0.0.1:7071");
}
var app = builder.Build();

var tenant = Environment.GetEnvironmentVariable("AZURE_TENANT_ID") ?? "";
var clientId = Environment.GetEnvironmentVariable("AZURE_CLIENT_ID") ?? "";
var clientSecret = Environment.GetEnvironmentVariable("AZURE_CLIENT_SECRET") ?? "";
var callback = Environment.GetEnvironmentVariable("CALLBACK_URI")
    ?? Environment.GetEnvironmentVariable("MEDIA_CALLBACK_URI")
    ?? "https://localhost/callback";
var publicBase = Environment.GetEnvironmentVariable("PUBLIC_BASE_URL") ?? "";
var speechKey = Environment.GetEnvironmentVariable("AZURE_SPEECH_KEY") ?? "";
var speechRegion = Environment.GetEnvironmentVariable("AZURE_SPEECH_REGION") ?? "uksouth";
var workerSecret = Environment.GetEnvironmentVariable("MEDIA_WORKER_SECRET") ?? "";
var orchestratorUrl = Environment.GetEnvironmentVariable("ORCHESTRATOR_URL") ?? "";

GraphJoinClient? graph = string.IsNullOrWhiteSpace(tenant) || string.IsNullOrWhiteSpace(clientId)
    ? null
    : new GraphJoinClient(tenant, clientId, clientSecret, callback);
AzureTts? tts = string.IsNullOrWhiteSpace(speechKey) ? null : new AzureTts(speechKey, speechRegion);

var registry = new CallRegistry();
var prompts = new PromptStore();
var log = app.Logger;

var sweep = new PeriodicTimer(TimeSpan.FromSeconds(30));
_ = Task.Run(async () =>
{
    while (await sweep.WaitForNextTickAsync()) prompts.Sweep(DateTimeOffset.UtcNow);
});

app.Lifetime.ApplicationStopping.Register(() =>
{
    sweep.Dispose();
    foreach (var (sessionId, callId) in registry.Snapshot())
    {
        if (graph is null || string.IsNullOrEmpty(callId)) continue;
        try { graph.DeleteCallAsync(callId).GetAwaiter().GetResult(); }
        catch { /* best-effort hangup */ }
        registry.Remove(sessionId);
    }
});

app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path.Value ?? "";
    var open = path == "/health" || path == "/callback" || path.StartsWith("/prompts/", StringComparison.OrdinalIgnoreCase);
    if (open)
    {
        await next();
        return;
    }
    var remote = ctx.Connection.RemoteIpAddress;
    var local = remote is not null && IPAddress.IsLoopback(remote);
    if (!string.IsNullOrEmpty(workerSecret))
    {
        var auth = ctx.Request.Headers.Authorization.ToString();
        if (auth != $"Bearer {workerSecret}")
        {
            ctx.Response.StatusCode = 401;
            await ctx.Response.WriteAsJsonAsync(new { error = "unauthorized" });
            return;
        }
    }
    else if (!local)
    {
        ctx.Response.StatusCode = 401;
        await ctx.Response.WriteAsJsonAsync(new { error = "non-local requests require MEDIA_WORKER_SECRET" });
        return;
    }
    await next();
});

app.MapGet("/health", () =>
{
    var publicLoopback = PublicBase.IsLoopback(publicBase);
    var configured = graph is not null && tts is not null && !publicLoopback;
    return Results.Json(new
    {
        healthy = configured,
        plane = "media",
        graph = graph is not null,
        tts = tts is not null,
        publicBase,
        publicLoopback,
        path = "A-playPrompt",
        callback,
    });
});

app.MapPost("/callback", async (HttpRequest req) =>
{
    var body = await new StreamReader(req.Body).ReadToEndAsync();
    foreach (var n in CallNotifications.Parse(body))
    {
        if (string.IsNullOrEmpty(n.CallId) || !registry.TryGetSession(n.CallId, out var sessionId)) continue;
        if (n.Established) registry.SetState(sessionId, CallLifecycle.Established);
        if (n.PlayCompleted)
        {
            prompts.Complete(registry.PeekActivePrompt(sessionId));
            registry.ClearActivePrompt(sessionId);
        }
        if (n.Terminated)
        {
            registry.SetState(sessionId, CallLifecycle.Terminated);
            await NotifyOrchestrator(sessionId, n.CallId, "ejected");
        }
    }
    return Results.Accepted();
});

app.MapPost("/admit", async (AdmitRequest body) =>
{
    if (graph is null) return Results.Json(new { error = "AZURE_* not set on the media worker" }, statusCode: 503);
    var thread = body.ThreadId
        ?? (string.IsNullOrEmpty(body.JoinUrl) ? null : GraphJoinClient.ThreadIdFromJoinUrl(body.JoinUrl));
    if (string.IsNullOrEmpty(thread))
    {
        return Results.Json(new { error = "joinUrl did not contain a 19: meeting thread id" }, statusCode: 400);
    }
    var callId = await graph.CreateCallAsync(thread, body.OrganizerId, body.TenantId);
    registry.Track(body.SessionId, callId);
    return Results.Json(new { videoSending = false, canHear = false, callId, state = "establishing" });
});

app.MapPost("/play", async (PlayRequest body) =>
{
    if (!registry.TryGetCall(body.SessionId, out var callId) || graph is null)
    {
        return Results.Json(new { error = "session not in a Graph call" }, statusCode: 404);
    }
    if (!registry.CanPlay(body.SessionId))
    {
        return Results.Json(new { error = "call not established" }, statusCode: 409);
    }
    if (tts is null)
    {
        return Results.Json(new { error = "AZURE_SPEECH_KEY is required; refusing to play silence" }, statusCode: 503);
    }
    if (string.IsNullOrWhiteSpace(publicBase) || PublicBase.IsLoopback(publicBase))
    {
        return Results.Json(new { error = "PUBLIC_BASE_URL must be a public HTTPS host Graph can GET (not localhost)" }, statusCode: 503);
    }
    byte[] wav;
    try
    {
        wav = await tts.SynthesizeWavAsync(body.Text);
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 503);
    }
    if (AzureTts.IsSilentPcm(wav))
    {
        return Results.Json(new { error = "refusing silent WAV" }, statusCode: 503);
    }
    var promptId = prompts.Put(body.UtteranceId, wav, DateTimeOffset.UtcNow);
    var uri = $"{publicBase.TrimEnd('/')}/prompts/{promptId}.wav";
    log.LogInformation("playPrompt mediaUri={Uri} utterance={UtteranceId}", uri, body.UtteranceId);
    await graph.PlayPromptAsync(callId, uri);
    registry.SetActivePrompt(body.SessionId, body.UtteranceId);
    return Results.Json(new { status = "playing", mediaUri = uri });
});

app.MapGet("/prompts/{id}.wav", (string id, HttpContext ctx) =>
{
    if (prompts.TryGet(id, out var wav))
    {
        log.LogInformation("GET /prompts/{Id}.wav {Status} from {Ip}", id, 200, ctx.Connection.RemoteIpAddress);
        return Results.File(wav, "audio/wav");
    }
    log.LogInformation("GET /prompts/{Id}.wav {Status} from {Ip}", id, 404, ctx.Connection.RemoteIpAddress);
    return Results.NotFound();
});

app.MapPost("/cancel", (SessionBody body) => StopPrompt(body.SessionId, body.UtteranceId));
app.MapPost("/barge-in", (SessionBody body) => StopPrompt(body.SessionId, null));
app.MapPost("/mute", (SessionBody body) => StopPrompt(body.SessionId, null));

app.MapPost("/leave", async (SessionBody body) =>
{
    var started = DateTime.UtcNow;
    if (registry.TryGetCall(body.SessionId, out var callId) && graph is not null)
    {
        await graph.DeleteCallAsync(callId);
    }
    registry.Remove(body.SessionId);
    return Results.Json(new { closeLatencyMs = (int)(DateTime.UtcNow - started).TotalMilliseconds });
});

async Task<IResult> StopPrompt(string sessionId, string? utteranceId)
{
    var started = DateTime.UtcNow;
    if (!registry.TryTakeActivePrompt(sessionId, utteranceId, out var taken))
    {
        return Results.Json(new { error = "nothing playing" }, statusCode: 409);
    }
    if (!registry.TryGetCall(sessionId, out var callId) || graph is null)
    {
        return Results.Json(new { error = "session not in a Graph call" }, statusCode: 404);
    }
    try
    {
        await graph.CancelMediaProcessingAsync(callId);
    }
    catch (Exception ex)
    {
        registry.SetActivePrompt(sessionId, taken);
        return Results.Json(new { error = ex.Message }, statusCode: 502);
    }
    prompts.Complete(taken);
    return Results.Json(new
    {
        cancelled = new[] { taken },
        stopLatencyMs = (int)(DateTime.UtcNow - started).TotalMilliseconds,
    });
}

app.Run();

async Task NotifyOrchestrator(string sessionId, string callId, string evt)
{
    if (string.IsNullOrWhiteSpace(orchestratorUrl)) return;
    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{orchestratorUrl.TrimEnd('/')}/internal/media-event");
        if (!string.IsNullOrEmpty(workerSecret))
        {
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", workerSecret);
        }
        req.Content = JsonContent.Create(new { sessionId, callId, @event = evt });
        await http.SendAsync(req);
    }
    catch
    {
        /* best-effort eject */
    }
}

public sealed record AdmitRequest(
    string SessionId,
    bool Avatar = false,
    bool Speak = true,
    string? JoinUrl = null,
    string? ThreadId = null,
    string? TenantId = null,
    string? OrganizerId = null);

public sealed record PlayRequest(
    string SessionId,
    string UtteranceId,
    string Text,
    int DurationMs = 800,
    bool AllowBargeIn = true,
    string Priority = "normal");

public sealed record SessionBody(string SessionId, string? UtteranceId = null);
