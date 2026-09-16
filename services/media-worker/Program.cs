using System.Collections.Concurrent;
using TeamsAudioJoin.MediaWorker;

var builder = WebApplication.CreateBuilder(args);
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

GraphJoinClient? graph = string.IsNullOrWhiteSpace(tenant) || string.IsNullOrWhiteSpace(clientId)
    ? null
    : new GraphJoinClient(tenant, clientId, clientSecret, callback);
AzureTts? tts = string.IsNullOrWhiteSpace(speechKey) ? null : new AzureTts(speechKey, speechRegion);

var calls = new ConcurrentDictionary<string, string>();
var prompts = new ConcurrentDictionary<string, byte[]>();

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
    _ = await new StreamReader(req.Body).ReadToEndAsync();
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
    calls[body.SessionId] = callId;
    return Results.Json(new { videoSending = false, canHear = false, callId });
});

app.MapPost("/play", async (PlayRequest body) =>
{
    if (!calls.TryGetValue(body.SessionId, out var callId) || graph is null)
    {
        return Results.Json(new { error = "session not in a Graph call" }, statusCode: 404);
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
    return Results.Json(new { status = "playing" });
});

app.MapGet("/prompts/{id}.wav", (string id) =>
    prompts.TryGetValue(id, out var wav) ? Results.File(wav, "audio/wav") : Results.NotFound());

app.MapPost("/cancel", (SessionBody body) => Results.Json(new { cancelled = Array.Empty<string>(), stopLatencyMs = 0 }));
app.MapPost("/barge-in", (SessionBody body) => Results.Json(new { cancelled = Array.Empty<string>(), stopLatencyMs = 0 }));
app.MapPost("/mute", (SessionBody body) => Results.Json(new { cancelled = Array.Empty<string>() }));

app.MapPost("/leave", async (SessionBody body) =>
{
    var started = DateTime.UtcNow;
    if (calls.TryRemove(body.SessionId, out var callId) && graph is not null)
    {
        await graph.DeleteCallAsync(callId);
    }
    return Results.Json(new { closeLatencyMs = (int)(DateTime.UtcNow - started).TotalMilliseconds });
});

app.Run();

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

public sealed record SessionBody(string SessionId);
