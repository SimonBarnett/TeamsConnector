using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace TeamsAudioJoin.MediaWorker;

/// <summary>Azure Speech REST (conversation) on 16 kHz mono WAV. No disk.</summary>
public sealed class AzureStt
{
    private readonly HttpClient _http;
    private readonly string _key;
    private readonly string _region;
    private readonly string _language;

    public AzureStt(string key, string region, string language = "en-GB", HttpClient? http = null)
    {
        _key = key;
        _region = region;
        _language = string.IsNullOrWhiteSpace(language) ? "en-GB" : language;
        _http = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
    }

    public async Task<string?> RecognizeWavAsync(byte[] wav, CancellationToken ct = default)
    {
        if (wav.Length < 44) return null;
        var url =
            $"https://{_region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language={Uri.EscapeDataString(_language)}";
        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        req.Headers.Add("Ocp-Apim-Subscription-Key", _key);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Content = new ByteArrayContent(wav);
        req.Content.Headers.ContentType = new MediaTypeHeaderValue("audio/wav") { CharSet = "audio/pcm" };
        using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode) return null;
        using var doc = JsonDocument.Parse(text);
        if (!doc.RootElement.TryGetProperty("RecognitionStatus", out var st)
            || !string.Equals(st.GetString(), "Success", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        var display = doc.RootElement.TryGetProperty("DisplayText", out var dt) ? dt.GetString() : null;
        return string.IsNullOrWhiteSpace(display) ? null : display.Trim();
    }
}
