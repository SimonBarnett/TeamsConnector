using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.CognitiveServices.Speech;
using Microsoft.CognitiveServices.Speech.Audio;

namespace TeamsAudioJoin.MediaWorker;

/// <summary>Azure Speech on 16 kHz mono WAV. SDK + phrase hints, REST fallback (tests inject HttpClient).</summary>
public sealed class AzureStt
{
    private static readonly string[] PhraseHints =
    {
        "the test phrase is mirror 44",
        "mirror 44",
        "mirror-44",
        "the quick brown fox jumped over the lazy dog",
    };

    private readonly HttpClient _http;
    private readonly string _key;
    private readonly string _region;
    private readonly string _language;
    private readonly bool _useSdk;
    public long LastMs { get; private set; }
    public long LastSdkMs { get; private set; }
    public long LastRestMs { get; private set; }
    public string LastPath { get; private set; } = "-";

    public AzureStt(string key, string region, string language = "en-GB", HttpClient? http = null)
    {
        _key = key;
        _region = region;
        _language = string.IsNullOrWhiteSpace(language) ? "en-GB" : language;
        _useSdk = http is null;
        _http = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
    }

    public async Task<string?> RecognizeWavAsync(byte[] wav, CancellationToken ct = default)
    {
        if (wav.Length < 44) return null;
        LastMs = LastSdkMs = LastRestMs = 0;
        LastPath = "-";
        var total = Stopwatch.StartNew();
        if (_useSdk && wav.Length < 44 + 16_000 * 2 * 2)
        {
            LastPath = "skip-short";
            LastMs = total.ElapsedMilliseconds;
            return null;
        }
        if (_useSdk)
        {
            var sdkSw = Stopwatch.StartNew();
            var sdk = await RecognizeSdkAsync(wav, ct).ConfigureAwait(false);
            LastSdkMs = sdkSw.ElapsedMilliseconds;
            LastPath = string.IsNullOrWhiteSpace(sdk) ? "sdk-empty" : "sdk";
            LastMs = total.ElapsedMilliseconds;
            // Do not REST-fallback: un-hinted REST is slower and worse (see ear logs).
            return sdk;
        }
        var restSw = Stopwatch.StartNew();
        var rest = await RecognizeRestAsync(wav, ct).ConfigureAwait(false);
        LastRestMs = restSw.ElapsedMilliseconds;
        LastPath = string.IsNullOrWhiteSpace(rest) ? "none" : "rest";
        LastMs = total.ElapsedMilliseconds;
        return rest;
    }

    private async Task<string?> RecognizeSdkAsync(byte[] wav, CancellationToken ct)
    {
        var tmp = Path.Combine(Path.GetTempPath(), "ear-" + Guid.NewGuid().ToString("n") + ".wav");
        try
        {
            await File.WriteAllBytesAsync(tmp, PadWavSilence(wav), ct).ConfigureAwait(false);
            var config = SpeechConfig.FromSubscription(_key, _region);
            config.SpeechRecognitionLanguage = _language;
            using var audio = AudioConfig.FromWavFileInput(tmp);
            using var reco = new SpeechRecognizer(config, audio);
            var phrases = PhraseListGrammar.FromRecognizer(reco);
            foreach (var p in PhraseHints) phrases.AddPhrase(p);
            var parts = new List<string>();
            var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            reco.Recognized += (_, e) =>
            {
                if (e.Result.Reason == ResultReason.RecognizedSpeech && !string.IsNullOrWhiteSpace(e.Result.Text))
                    parts.Add(e.Result.Text.Trim());
            };
            reco.Canceled += (_, _) => done.TrySetResult(false);
            reco.SessionStopped += (_, _) => done.TrySetResult(true);
            await reco.StartContinuousRecognitionAsync().ConfigureAwait(false);
            try
            {
                using (ct.Register(() => done.TrySetCanceled(ct)))
                    await done.Task.WaitAsync(TimeSpan.FromSeconds(20), ct).ConfigureAwait(false);
            }
            finally
            {
                await reco.StopContinuousRecognitionAsync().ConfigureAwait(false);
            }
            if (parts.Count == 0) return null;
            return string.Join(" ", parts);
        }
        catch
        {
            return null;
        }
        finally
        {
            try { File.Delete(tmp); } catch { /* temp */ }
        }
    }

    private async Task<string?> RecognizeRestAsync(byte[] wav, CancellationToken ct)
    {
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

    /// <summary>150 ms of silence at each end — helps Azure not clip the first/last word.</summary>
    private static byte[] PadWavSilence(byte[] wav)
    {
        if (wav.Length < 44) return wav;
        const int pad = 16_000 * 2 * 15 / 100; // 150 ms 16 kHz 16-bit mono
        var data = wav.Length - 44;
        var n = 44 + pad + data + pad;
        var o = new byte[n];
        Buffer.BlockCopy(wav, 0, o, 0, 44);
        Buffer.BlockCopy(wav, 44, o, 44 + pad, data);
        var size = n - 8;
        var dlen = n - 44;
        o[4] = (byte)size; o[5] = (byte)(size >> 8); o[6] = (byte)(size >> 16); o[7] = (byte)(size >> 24);
        o[40] = (byte)dlen; o[41] = (byte)(dlen >> 8); o[42] = (byte)(dlen >> 16); o[43] = (byte)(dlen >> 24);
        return o;
    }
}
