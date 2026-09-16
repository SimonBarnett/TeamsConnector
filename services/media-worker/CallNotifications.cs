using System.Text.Json;
using System.Text.RegularExpressions;

namespace TeamsAudioJoin.MediaWorker;

public sealed record CallNotification(
    string? CallId,
    string? ChangeType,
    string? State,
    bool Terminated,
    bool Established,
    bool PlayCompleted);

/// <summary>Parse Graph Cloud Communications callback JSON (commsNotifications).</summary>
public static class CallNotifications
{
    private static readonly Regex CallIdRe = new(@"/calls/([^/?]+)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static IReadOnlyList<CallNotification> Parse(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Array.Empty<CallNotification>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            var list = new List<CallNotification>();
            Walk(doc.RootElement, list);
            return list;
        }
        catch (JsonException)
        {
            return Array.Empty<CallNotification>();
        }
    }

    private static void Walk(JsonElement el, List<CallNotification> list)
    {
        if (el.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in el.EnumerateArray()) Walk(item, list);
            return;
        }
        if (el.ValueKind != JsonValueKind.Object) return;

        var changeType = GetString(el, "changeType");
        var resourceUrl = GetString(el, "resourceUrl") ?? GetString(el, "resource");
        string? state = null;
        var playCompleted = false;
        var odata = GetString(el, "@odata.type") ?? "";

        if (el.TryGetProperty("resourceData", out var rd) && rd.ValueKind == JsonValueKind.Object)
        {
            state = GetString(rd, "state");
            var status = GetString(rd, "status");
            var rdType = GetString(rd, "@odata.type") ?? "";
            if (rdType.Contains("playPrompt", StringComparison.OrdinalIgnoreCase)
                && string.Equals(status, "completed", StringComparison.OrdinalIgnoreCase))
            {
                playCompleted = true;
            }
            if (state is null) state = GetString(rd, "callState");
        }

        if (el.TryGetProperty("state", out _))
        {
            state ??= GetString(el, "state");
        }

        var callId = ExtractCallId(resourceUrl) ?? GetString(el, "id");
        var terminated =
            string.Equals(changeType, "deleted", StringComparison.OrdinalIgnoreCase)
            || string.Equals(state, "terminated", StringComparison.OrdinalIgnoreCase)
            || string.Equals(state, "terminating", StringComparison.OrdinalIgnoreCase);
        var established = string.Equals(state, "established", StringComparison.OrdinalIgnoreCase);

        if (callId is not null || changeType is not null || state is not null || playCompleted)
        {
            if (odata.Contains("commsNotification", StringComparison.OrdinalIgnoreCase)
                || changeType is not null
                || established
                || terminated
                || playCompleted)
            {
                list.Add(new CallNotification(callId, changeType, state, terminated, established, playCompleted));
            }
        }

        foreach (var prop in el.EnumerateObject())
        {
            if (prop.NameEquals("resourceData")) continue;
            if (prop.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
            {
                Walk(prop.Value, list);
            }
        }
    }

    private static string? ExtractCallId(string? resourceUrl)
    {
        if (string.IsNullOrEmpty(resourceUrl)) return null;
        var m = CallIdRe.Match(resourceUrl);
        return m.Success ? m.Groups[1].Value : null;
    }

    private static string? GetString(JsonElement el, string name)
    {
        if (!el.TryGetProperty(name, out var v)) return null;
        return v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString();
    }
}
