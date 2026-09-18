using System.Text.Json;

namespace TeamsAudioJoin.MediaHost;

internal static class GraphCallFileLog
{
    private static readonly object Gate = new();

    internal static string Path { get; } =
        Environment.GetEnvironmentVariable("GRAPH_CALL_LOG")
        ?? System.IO.Path.Combine(AppContext.BaseDirectory, "graph-call.log");

    internal static void Line(string text)
    {
        try
        {
            lock (Gate)
            {
                File.AppendAllText(Path, DateTime.UtcNow.ToString("o") + " " + text + Environment.NewLine);
            }
        }
        catch
        {
            /* best-effort */
        }
    }

    internal static async Task CallbackBodyAsync(Stream body, CancellationToken ct)
    {
        try
        {
            using var doc = await JsonDocument.ParseAsync(body, cancellationToken: ct).ConfigureAwait(false);
            foreach (var item in EnumerateNotifications(doc.RootElement))
            {
                var change = GetString(item, "changeType") ?? "-";
                var resource = item.TryGetProperty("resourceData", out var rd) ? rd : item;
                var state = GetString(resource, "state") ?? "-";
                var code = GetNumber(resource, "resultInfo", "code");
                var sub = GetNumber(resource, "resultInfo", "subcode");
                var msg = GetNestedString(resource, "resultInfo", "message") ?? "-";
                Line($"callback changeType={change} state={state} resultCode={code} resultSubcode={sub} result={msg}");
            }
        }
        catch (JsonException)
        {
            Line("callback body not json");
        }
        catch
        {
            /* best-effort */
        }
    }

    private static IEnumerable<JsonElement> EnumerateNotifications(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("value", out var value)
            && value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
            {
                yield return item;
            }
            yield break;
        }
        if (root.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in root.EnumerateArray())
            {
                yield return item;
            }
            yield break;
        }
        yield return root;
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String
            ? p.GetString()
            : obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var n) && n.ValueKind is JsonValueKind.Number or JsonValueKind.True or JsonValueKind.False
                ? n.ToString()
                : null;

    private static string GetNumber(JsonElement obj, string parent, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(parent, out var p) || p.ValueKind != JsonValueKind.Object)
        {
            return "-";
        }
        if (!p.TryGetProperty(name, out var n))
        {
            return "-";
        }
        return n.ValueKind == JsonValueKind.Number ? n.ToString() : n.ToString();
    }

    private static string? GetNestedString(JsonElement obj, string parent, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(parent, out var p) || p.ValueKind != JsonValueKind.Object)
        {
            return null;
        }
        return GetString(p, name);
    }
}
