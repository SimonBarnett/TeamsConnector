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
var prompts = new System.Collections.Concurrent.ConcurrentDictionary<string, byte[]>();

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
    var configured = graph is not null && tts is not null;
    return Results.Json(new
    {
        healthy = configured,
        plane = "media",
        graph = graph is not null,
        tts = tts is not null,
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
        if (n.PlayCompleted) registry.ClearActivePrompt(sessionId);
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
    if (string.IsNullOrWhiteSpace(publicBase))
    {
        return Results.Json(new { error = "PUBLIC_BASE_URL is required for playPrompt" }, statusCode: 503);
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
    prompts[body.UtteranceId] = wav;
    var uri = $"{publicBase.TrimEnd('/')}/prompts/{Uri.EscapeDataString(body.UtteranceId)}.wav";
    await graph.PlayPromptAsync(callId, uri);
    registry.SetActivePrompt(body.SessionId, body.UtteranceId);
    return Results.Json(new { status = "playing" });
});

app.MapGet("/prompts/{id}.wav", (string id) =>
    prompts.TryGetValue(id, out var wav) ? Results.File(wav, "audio/wav") : Results.NotFound());

app.MapPost("/cancel", async (SessionBody body) =>
{
    var started = DateTime.UtcNow;
    if (!registry.TryTakeActivePrompt(body.SessionId, body.UtteranceId, out var utteranceId))
    {
        return Results.Json(new { error = "nothing playing" }, statusCode: 409);
    }
    if (!registry.TryGetCall(body.SessionId, out var callId) || graph is null)
    {
        return Results.Json(new { error = "session not in a Graph call" }, statusCode: 404);
    }
    try
    {
        await graph.CancelMediaProcessingAsync(callId);
    }
    catch (Exception ex)
    {
        registry.SetActivePrompt(body.SessionId, utteranceId);
        return Results.Json(new { error = ex.Message }, statusCode: 502);
    }
    return Results.Json(new
    {
        cancelled = new[] { utteranceId },
        stopLatencyMs = (int)(DateTime.UtcNow - started).TotalMilliseconds,
    });
});

app.MapPost("/barge-in", async (SessionBody body) =>
{
    var started = DateTime.UtcNow;
    if (!registry.TryTakeActivePrompt(body.SessionId, null, out var utteranceId))
    {
        return Results.Json(new { error = "nothing playing" }, statusCode: 409);
    }
    if (!registry.TryGetCall(body.SessionId, out var callId) || graph is null)
    {
        return Results.Json(new { error = "session not in a Graph call" }, statusCode: 404);
    }
    try
    {
        await graph.CancelMediaProcessingAsync(callId);
    }
    catch (Exception ex)
    {
        registry.SetActivePrompt(body.SessionId, utteranceId);
        return Results.Json(new { error = ex.Message }, statusCode: 502);
    }
    return Results.Json(new
    {
        cancelled = new[] { utteranceId },
        stopLatencyMs = (int)(DateTime.UtcNow - started).TotalMilliseconds,
    });
});

app.MapPost("/mute", (SessionBody body) =>
{
    if (!registry.TryTakeActivePrompt(body.SessionId, null, out var utteranceId))
    {
        return Results.Json(new { cancelled = Array.Empty<string>() });
    }
    return Results.Json(new { cancelled = new[] { utteranceId } });
});

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
