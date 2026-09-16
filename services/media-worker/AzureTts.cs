using System.Net.Http.Headers;
using System.Text;
using System.Xml.Linq;

namespace TeamsAudioJoin.MediaWorker;

/// <summary>Azure Neural TTS → riff 16 kHz 16-bit mono WAV. Never returns silence.</summary>
public sealed class AzureTts
{
    private readonly HttpClient _http;
    private readonly string _key;
    private readonly string _region;
    private readonly string _voice;

    public AzureTts(string key, string region, string? voice = null, HttpClient? http = null)
    {
        _key = key;
        _region = region;
        _voice = string.IsNullOrWhiteSpace(voice) ? "en-GB-SoniaNeural" : voice;
        _http = http ?? new HttpClient();
    }

    public static bool IsSilentPcm(byte[] wavOrPcm)
    {
        var pcm = wavOrPcm.Length > 44 && wavOrPcm[0] == (byte)'R' ? wavOrPcm.AsSpan(44) : wavOrPcm.AsSpan();
        foreach (var b in pcm)
        {
            if (b != 0) return false;
        }
        return true;
    }

    public async Task<byte[]> SynthesizeWavAsync(string text, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(text)) throw new InvalidOperationException("TTS text is empty.");
        var ssml = new XElement("speak",
            new XAttribute("version", "1.0"),
            new XAttribute(XNamespace.Xml + "lang", "en-GB"),
            new XElement("voice",
                new XAttribute(XNamespace.Xml + "lang", "en-GB"),
                new XAttribute("name", _voice),
                text));
        using var req = new HttpRequestMessage(HttpMethod.Post, $"https://{_region}.tts.speech.microsoft.com/cognitiveservices/v1");
        req.Headers.Add("Ocp-Apim-Subscription-Key", _key);
        req.Headers.Add("X-Microsoft-OutputFormat", "riff-16khz-16bit-mono-pcm");
        req.Headers.UserAgent.ParseAdd("teams-audio-join");
        req.Content = new StringContent(ssml.ToString(SaveOptions.DisableFormatting), Encoding.UTF8, "application/ssml+xml");
        using var res = await _http.SendAsync(req, ct).ConfigureAwait(false);
        var bytes = await res.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Azure TTS {(int)res.StatusCode}: {Encoding.UTF8.GetString(bytes)}");
        }
        if (bytes.Length < 44 || IsSilentPcm(bytes))
        {
            throw new InvalidOperationException("Azure TTS returned empty or silent audio.");
        }
        return bytes;
    }
}
