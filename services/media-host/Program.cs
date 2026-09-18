using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography.X509Certificates;
using TeamsAudioJoin.MediaHost;
using TeamsAudioJoin.MediaWorker;

foreach (var dir in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
{
    var probe = dir;
    for (var i = 0; i < 8 && !string.IsNullOrEmpty(probe); i++)
    {
        LoadDotEnv(Path.Combine(probe, ".env"));
        probe = Directory.GetParent(probe)?.FullName ?? "";
    }
}

var builder = WebApplication.CreateBuilder(args);
var listenPort = Environment.GetEnvironmentVariable("MEDIA_HOST_PORT")
    ?? Environment.GetEnvironmentVariable("PORT")
    ?? "7072";
var httpsPort = Environment.GetEnvironmentVariable("MEDIA_HTTPS_PORT");
var fqdn = Environment.GetEnvironmentVariable("MEDIA_SERVICE_FQDN") ?? "rtp-teams.ntsa.uk";
var cert = HostedMediaRuntime.LoadCertificate(
    Environment.GetEnvironmentVariable("MEDIA_CERT_THUMBPRINT"), fqdn);

builder.WebHost.ConfigureKestrel(k =>
{
    k.Listen(IPAddress.Any, int.Parse(listenPort));
    if (int.TryParse(httpsPort, out var hp) && hp > 0 && cert is not null)
    {
        k.Listen(IPAddress.Any, hp, lo => lo.UseHttps(cert));
    }
});

var app = builder.Build();
var log = app.Logger;

var speechKey = Environment.GetEnvironmentVariable("AZURE_SPEECH_KEY") ?? "";
var speechRegion = Environment.GetEnvironmentVariable("AZURE_SPEECH_REGION") ?? "uksouth";
var workerSecret = Environment.GetEnvironmentVariable("MEDIA_WORKER_SECRET") ?? "";
var orchestratorUrl = Environment.GetEnvironmentVariable("ORCHESTRATOR_URL") ?? "";
AzureTts? tts = string.IsNullOrWhiteSpace(speechKey) ? null : new AzureTts(speechKey, speechRegion);
AzureStt? stt = string.IsNullOrWhiteSpace(speechKey) ? null : new AzureStt(speechKey, speechRegion);

var registry = new CallRegistry();
var runtime = new HostedMediaRuntime(log, stt, tts);
_ = Task.Run(() =>
{
    try { runtime.TryStart(); }
    catch (Exception ex) { log.LogError(ex, "media platform start failed"); }
});

app.Lifetime.ApplicationStopping.Register(() =>
{
    foreach (var (sessionId, _) in registry.Snapshot())
    {
        try { runtime.LeaveAsync(sessionId).GetAwaiter().GetResult(); }
        catch { /* best-effort */ }
        registry.Remove(sessionId);
    }
    runtime.Dispose();
});

app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path.Value ?? "";
    var open = path == "/health" || path == "/callback";
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
    var callback = runtime.CallbackUri;
    var publicLoopback = PublicBase.IsLoopback(callback);
    var healthy = runtime.MediaReady && tts is not null && !publicLoopback;
    return Results.Json(new
    {
        healthy,
        plane = "media",
        graph = runtime.MediaReady,
        tts = tts is not null,
        stt = stt is not null,
        publicBase = callback,
        publicLoopback,
        path = "B-accessMedia",
        callback,
        serviceFqdn = runtime.ServiceFqdn,
        publicIp = runtime.PublicIp,
        publicPort = runtime.PublicPort,
        cert = runtime.Certificate is not null,
        mediaReady = runtime.MediaReady,
        initError = runtime.InitError,
    });
});

app.MapPost("/callback", async (HttpContext ctx) =>
{
    ctx.Request.EnableBuffering();
    using var request = ToRequestMessage(ctx.Request);
    log.LogInformation("graph callback {Uri} auth={Auth}", request.RequestUri, ctx.Request.Headers.ContainsKey("Authorization"));
    var response = await runtime.ProcessNotificationAsync(request);
    ctx.Response.StatusCode = (int)response.StatusCode;
    foreach (var header in response.Headers)
    {
        ctx.Response.Headers[header.Key] = header.Value.ToArray();
    }
    if (response.Content is not null)
    {
        foreach (var header in response.Content.Headers)
        {
            ctx.Response.Headers[header.Key] = header.Value.ToArray();
        }
        await response.Content.CopyToAsync(ctx.Response.Body);
    }
});

app.MapPost("/admit", async (AdmitRequest body) =>
{
    if (!runtime.MediaReady)
    {
        return Results.Json(new { error = runtime.InitError ?? "media platform not ready" }, statusCode: 503);
    }
    try
    {
        var callId = await runtime.JoinAsync(
            body.SessionId,
            body.JoinUrl,
            body.ThreadId,
            body.OrganizerId,
            body.TenantId,
            async text =>
            {
                var id = registry.TryGetCall(body.SessionId, out var cid) ? cid : "";
                await NotifyOrchestrator(body.SessionId, id, "transcript", new[]
                {
                    new { text, speaker = "Speaker 1", tMs = 0, isPartial = false },
                });
            },
            (sessionId, established) =>
            {
                if (!registry.TryGetCall(sessionId, out var id)) return;
                if (established)
                {
                    registry.SetState(sessionId, CallLifecycle.Established);
                    _ = NotifyOrchestrator(sessionId, id, "established");
                }
                else
                {
                    registry.SetState(sessionId, CallLifecycle.Terminated);
                    _ = NotifyOrchestrator(sessionId, id, "ejected");
                }
            });
        registry.Track(body.SessionId, callId);
        if (runtime.TryGetCall(body.SessionId, out var hosted) && hosted.Established)
        {
            registry.SetState(body.SessionId, CallLifecycle.Established);
        }
        return Results.Json(new { videoSending = false, canHear = false, callId, state = "establishing" });
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 502);
    }
});

app.MapPost("/play", async (PlayRequest body) =>
{
    if (!registry.TryGetCall(body.SessionId, out var callId))
    {
        return Results.Json(new { error = "session not in a Graph call" }, statusCode: 404);
    }
    if (!registry.CanPlay(body.SessionId))
    {
        return Results.Json(new { error = "call not established" }, statusCode: 409);
    }
    try
    {
        await runtime.PlayAsync(body.SessionId, body.UtteranceId, body.Text);
        registry.SetActivePrompt(body.SessionId, body.UtteranceId);
        return Results.Json(new { status = "playing" });
    }
    catch (Exception ex)
    {
        return Results.Json(new { error = ex.Message }, statusCode: 503);
    }
});

app.MapPost("/cancel", (SessionBody body) => StopPrompt(body.SessionId, body.UtteranceId));
app.MapPost("/barge-in", (SessionBody body) => StopPrompt(body.SessionId, null));
app.MapPost("/mute", (SessionBody body) => StopPrompt(body.SessionId, null));

app.MapPost("/leave", async (SessionBody body) =>
{
    var started = DateTime.UtcNow;
    await runtime.LeaveAsync(body.SessionId);
    registry.Remove(body.SessionId);
    return Results.Json(new { closeLatencyMs = (int)(DateTime.UtcNow - started).TotalMilliseconds });
});

IResult StopPrompt(string sessionId, string? utteranceId)
{
    var started = DateTime.UtcNow;
    if (!registry.TryTakeActivePrompt(sessionId, utteranceId, out var taken))
    {
        return Results.Json(new { error = "nothing playing" }, statusCode: 409);
    }
    runtime.CancelPlay(sessionId);
    return Results.Json(new
    {
        cancelled = new[] { taken },
        stopLatencyMs = (int)(DateTime.UtcNow - started).TotalMilliseconds,
    });
}

async Task NotifyOrchestrator(string sessionId, string callId, string evt, object? cues = null)
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
        req.Content = JsonContent.Create(new { sessionId, callId, @event = evt, cues });
        await http.SendAsync(req);
    }
    catch
    {
        /* best-effort */
    }
}

app.Run();

static HttpRequestMessage ToRequestMessage(HttpRequest req)
{
    var message = new HttpRequestMessage();
    message.Method = new HttpMethod(req.Method);
    // ARR rewrites to http://127.0.0.1:7072; Graph signed the public HTTPS callback.
    var callback = Environment.GetEnvironmentVariable("CALLBACK_URI")
        ?? Environment.GetEnvironmentVariable("MEDIA_CALLBACK_URI");
    Uri uri;
    if (Uri.TryCreate(callback, UriKind.Absolute, out var cb))
    {
        uri = new Uri(cb, req.Path + req.QueryString);
    }
    else
    {
        uri = new Uri($"{req.Scheme}://{req.Host}{req.Path}{req.QueryString}");
    }
    message.RequestUri = uri;
    message.Content = new StreamContent(req.Body);
    foreach (var header in req.Headers)
    {
        if (!message.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray()))
        {
            message.Content.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
        }
    }
    return message;
}

static void LoadDotEnv(string path)
{
    try
    {
        path = Path.GetFullPath(path);
        if (!File.Exists(path)) return;
        foreach (var raw in File.ReadAllLines(path))
        {
            var line = raw.Trim();
            if (line.Length == 0 || line.StartsWith('#') || !line.Contains('=')) continue;
            var i = line.IndexOf('=');
            var key = line[..i].Trim();
            var val = line[(i + 1)..].Trim().Trim('"');
            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
            {
                Environment.SetEnvironmentVariable(key, val);
            }
        }
    }
    catch
    {
        /* optional */
    }
}

public sealed record AdmitRequest(
    string SessionId,
    bool Avatar = false,
    bool Speak = true,
    string? JoinUrl = null,
    string? ThreadId = null,
    string? TenantId = null,
    string? OrganizerId = null,
    string? OnlineMeetingId = null);

public sealed record PlayRequest(
    string SessionId,
    string UtteranceId,
    string Text,
    int DurationMs = 800,
    bool AllowBargeIn = true,
    string Priority = "normal");

public sealed record SessionBody(string SessionId, string? UtteranceId = null);
