using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TeamsAudioJoin.MediaWorker;

public sealed class GraphJoinClient
{
    private readonly HttpClient _http;
    private readonly string _tenantId;
    private readonly string _clientId;
    private readonly string _clientSecret;
    private readonly string _callbackUri;
    private string? _token;
    private DateTimeOffset _tokenExpires;

    public GraphJoinClient(string tenantId, string clientId, string clientSecret, string callbackUri, HttpClient? http = null)
    {
        _tenantId = tenantId;
        _clientId = clientId;
        _clientSecret = clientSecret;
        _callbackUri = callbackUri;
        _http = http ?? new HttpClient();
    }

    public static string? ThreadIdFromJoinUrl(string joinUrl)
    {
        try
        {
            var path = Uri.UnescapeDataString(new Uri(joinUrl).AbsolutePath);
            var m = Regex.Match(path, @"meetup-join/(19:[^/]+)", RegexOptions.IgnoreCase);
            if (!m.Success) return null;
            var id = m.Groups[1].Value;
            return id.Contains('@') ? id : id + "@thread.v2";
        }
        catch
        {
            return null;
        }
    }

    public async Task<string> CreateCallAsync(
        string threadId,
        string? organizerId,
        string? tenantId,
        CancellationToken ct = default)
    {
        var token = await GetTokenAsync(ct).ConfigureAwait(false);
        var body = new Dictionary<string, object?>
        {
            ["callbackUri"] = _callbackUri,
            ["requestedModalities"] = new[] { "audio" },
            ["mediaConfig"] = new Dictionary<string, object?>
            {
                ["@odata.type"] = "#microsoft.graph.serviceHostedMediaConfig",
            },
            ["chatInfo"] = new Dictionary<string, object?>
            {
                ["@odata.type"] = "#microsoft.graph.chatInfo",
                ["threadId"] = threadId,
                ["messageId"] = "0",
            },
        };
        if (!string.IsNullOrEmpty(tenantId))
        {
            body["tenantId"] = tenantId;
            body["source"] = new Dictionary<string, object?>
            {
                ["@odata.type"] = "#microsoft.graph.participantInfo",
                ["identity"] = new Dictionary<string, object?>
                {
                    ["@odata.type"] = "#microsoft.graph.identitySet",
                    ["application"] = new Dictionary<string, object?>
                    {
                        ["@odata.type"] = "#microsoft.graph.identity",
                        ["id"] = _clientId,
                        ["displayName"] = "teams-audio-join-connector",
                        ["tenantId"] = tenantId,
                    },
                },
            };
        }
        if (!string.IsNullOrEmpty(organizerId))
        {
            var user = new Dictionary<string, object?>
            {
                ["@odata.type"] = "#microsoft.graph.identity",
                ["id"] = organizerId,
            };
            if (!string.IsNullOrEmpty(tenantId)) user["tenantId"] = tenantId;
            body["meetingInfo"] = new Dictionary<string, object?>
            {
                ["@odata.type"] = "#microsoft.graph.organizerMeetingInfo",
                ["organizer"] = new Dictionary<string, object?>
                {
                    ["@odata.type"] = "#microsoft.graph.identitySet",
                    ["user"] = user,
                },
                ["allowConversationWithoutHost"] = true,
            };
        }

        using var req = new HttpRequestMessage(HttpMethod.Post, "https://graph.microsoft.com/v1.0/communications/calls");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Graph createCall {(int)res.StatusCode}: {text}");
        }
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.GetProperty("id").GetString()
            ?? throw new InvalidOperationException("createCall missing id");
    }

    public async Task PlayPromptAsync(string callId, string mediaUri, CancellationToken ct = default)
    {
        var token = await GetTokenAsync(ct).ConfigureAwait(false);
        var body = new
        {
            prompts = new[]
            {
                new Dictionary<string, object?>
                {
                    ["@odata.type"] = "#microsoft.graph.mediaPrompt",
                    ["mediaInfo"] = new Dictionary<string, object?>
                    {
                        ["@odata.type"] = "#microsoft.graph.mediaInfo",
                        ["uri"] = mediaUri,
                    },
                },
            },
        };
        using var req = new HttpRequestMessage(HttpMethod.Post, $"https://graph.microsoft.com/v1.0/communications/calls/{callId}/playPrompt");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
        {
            var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            throw new InvalidOperationException($"Graph playPrompt {(int)res.StatusCode}: {text}");
        }
    }

    public async Task CancelMediaProcessingAsync(string callId, CancellationToken ct = default)
    {
        var token = await GetTokenAsync(ct).ConfigureAwait(false);
        var body = new { clientContext = Guid.NewGuid().ToString("N") };
        using var req = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://graph.microsoft.com/v1.0/communications/calls/{callId}/cancelMediaProcessing");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
        {
            var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            throw new InvalidOperationException($"Graph cancelMediaProcessing {(int)res.StatusCode}: {text}");
        }
    }

    public async Task DeleteCallAsync(string callId, CancellationToken ct = default)
    {
        var token = await GetTokenAsync(ct).ConfigureAwait(false);
        using var req = new HttpRequestMessage(HttpMethod.Delete, $"https://graph.microsoft.com/v1.0/communications/calls/{callId}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode && res.StatusCode != System.Net.HttpStatusCode.NotFound)
        {
            var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            throw new InvalidOperationException($"Graph deleteCall {(int)res.StatusCode}: {text}");
        }
    }

    public async Task<IReadOnlyList<(string Id, string Vtt)>> ListTranscriptVttsAsync(
        string organizerUserId,
        string onlineMeetingId,
        CancellationToken ct = default)
    {
        var token = await GetTokenAsync(ct).ConfigureAwait(false);
        var listUrl =
            $"https://graph.microsoft.com/v1.0/users/{Uri.EscapeDataString(organizerUserId)}/onlineMeetings/{Uri.EscapeDataString(onlineMeetingId)}/transcripts";
        using var listReq = new HttpRequestMessage(HttpMethod.Get, listUrl);
        listReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var listRes = await _http.SendAsync(listReq, ct).ConfigureAwait(false);
        if (listRes.StatusCode == System.Net.HttpStatusCode.NotFound) return [];
        var listText = await listRes.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!listRes.IsSuccessStatusCode) return [];
        using var doc = JsonDocument.Parse(listText);
        if (!doc.RootElement.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Array)
        {
            return [];
        }
        var outList = new List<(string Id, string Vtt)>();
        foreach (var t in value.EnumerateArray())
        {
            var id = t.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
            if (string.IsNullOrEmpty(id)) continue;
            var contentUrl =
                $"https://graph.microsoft.com/v1.0/users/{Uri.EscapeDataString(organizerUserId)}/onlineMeetings/{Uri.EscapeDataString(onlineMeetingId)}/transcripts/{Uri.EscapeDataString(id)}/content?$format=text/vtt";
            using var cReq = new HttpRequestMessage(HttpMethod.Get, contentUrl);
            cReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var cRes = await _http.SendAsync(cReq, ct).ConfigureAwait(false);
            if (!cRes.IsSuccessStatusCode) continue;
            outList.Add((id, await cRes.Content.ReadAsStringAsync(ct).ConfigureAwait(false)));
        }
        return outList;
    }

    private async Task<string> GetTokenAsync(CancellationToken ct)
    {
        if (_token is not null && _tokenExpires > DateTimeOffset.UtcNow.AddMinutes(2)) return _token;
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = _clientId,
            ["client_secret"] = _clientSecret,
            ["scope"] = "https://graph.microsoft.com/.default",
            ["grant_type"] = "client_credentials",
        });
        using var res = await _http.PostAsync($"https://login.microsoftonline.com/{_tenantId}/oauth2/v2.0/token", form, ct)
            .ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"token {(int)res.StatusCode}: {text}");
        using var doc = JsonDocument.Parse(text);
        _token = doc.RootElement.GetProperty("access_token").GetString()!;
        var expires = doc.RootElement.TryGetProperty("expires_in", out var ein) ? ein.GetInt32() : 3600;
        _tokenExpires = DateTimeOffset.UtcNow.AddSeconds(expires);
        return _token;
    }
}
