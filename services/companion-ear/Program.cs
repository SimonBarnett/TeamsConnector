using System.Net.Http.Headers;
using System.Net.Http.Json;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using TeamsAudioJoin.MediaWorker;

if (args.Contains("--list", StringComparer.OrdinalIgnoreCase))
{
    for (var i = 0; i < WaveOut.DeviceCount; i++)
    {
        var cap = WaveOut.GetCapabilities(i);
        Console.WriteLine($"{i}\t{cap.ProductName}");
    }
    Console.WriteLine("(loopback captures the WASAPI render mix, not a WaveOut index)");
    return;
}

var url = Arg("--url") ?? Environment.GetEnvironmentVariable("EAR_URL") ?? "https://rtp-teams.ntsa.uk";
var session = Arg("--session") ?? Environment.GetEnvironmentVariable("EAR_SESSION")
    ?? throw new InvalidOperationException("set --session or EAR_SESSION");
var token = Arg("--token") ?? Environment.GetEnvironmentVariable("MEDIA_WORKER_SECRET")
    ?? throw new InvalidOperationException("set --token or MEDIA_WORKER_SECRET");
var seconds = double.TryParse(Arg("--chunk"), out var ch) ? ch : 2.5;

using var capture = new WasapiLoopbackCapture();
var format = capture.WaveFormat;
Console.WriteLine($"loopback {format.SampleRate} Hz {format.Channels} ch {format.BitsPerSample}-bit -> 16 kHz mono");
Console.WriteLine($"POST {url.TrimEnd('/')}/ear session={session}");

var buffered = new BufferedWaveProvider(format)
{
    DiscardOnBufferOverflow = true,
    BufferDuration = TimeSpan.FromSeconds(10),
};
capture.DataAvailable += (_, e) =>
{
    if (e.BytesRecorded > 0) buffered.AddSamples(e.Buffer, 0, e.BytesRecorded);
};
capture.RecordingStopped += (_, e) =>
{
    if (e.Exception is not null) Console.Error.WriteLine(e.Exception.Message);
};

using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

capture.StartRecording();
using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

var sample = buffered.ToSampleProvider();
ISampleProvider chain = format.Channels == 2 ? new StereoToMonoSampleProvider(sample) : sample;
if (format.SampleRate != 16_000)
{
    chain = new WdlResamplingSampleProvider(chain, 16_000);
}

var floatBuf = new float[16_000]; // 1 s
var pcm = new byte[16_000 * 2 * 4]; // up to 4 s
try
{
    while (!cts.IsCancellationRequested)
    {
        var need = (int)(16_000 * seconds);
        var got = 0;
        var deadline = DateTime.UtcNow.AddSeconds(seconds + 1);
        while (got < need && DateTime.UtcNow < deadline && !cts.IsCancellationRequested)
        {
            var n = chain.Read(floatBuf, 0, Math.Min(floatBuf.Length, need - got));
            if (n == 0)
            {
                await Task.Delay(40, cts.Token).ConfigureAwait(false);
                continue;
            }
            for (var i = 0; i < n; i++)
            {
                var s = (short)Math.Clamp(floatBuf[i] * 32767f, short.MinValue, short.MaxValue);
                var o = (got + i) * 2;
                if (o + 1 >= pcm.Length) Array.Resize(ref pcm, (got + n) * 2 + 4096);
                pcm[o] = (byte)(s & 0xff);
                pcm[o + 1] = (byte)((s >> 8) & 0xff);
            }
            got += n;
        }
        var sliceLen = got * 2;
        var sliceArr = new byte[sliceLen];
        Buffer.BlockCopy(pcm, 0, sliceArr, 0, sliceLen);
        var energy = PcmWav.HasEnergy(sliceArr);
        var wav = energy ? PcmWav.Wrap16kMono(sliceArr) : Array.Empty<byte>();
        using var res = await http.PostAsJsonAsync(
            $"{url.TrimEnd('/')}/ear",
            new { sessionId = session, wavBase64 = wav.Length == 0 ? "" : Convert.ToBase64String(wav) },
            cts.Token).ConfigureAwait(false);
        var body = await res.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false);
        Console.WriteLine($"{DateTime.UtcNow:HH:mm:ss} {(int)res.StatusCode} energy={energy} {Trim(body)}");
    }
}
catch (OperationCanceledException)
{
    /* Ctrl+C */
}
finally
{
    capture.StopRecording();
}

string? Arg(string name)
{
    var i = Array.FindIndex(args, a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}

static string Trim(string s) => s.Length <= 180 ? s : s[..180] + "…";
