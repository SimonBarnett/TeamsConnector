using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using TeamsAudioJoin.MediaWorker;

LoadNearbyDotEnv();

if (args.Contains("--help", StringComparer.OrdinalIgnoreCase) || args.Contains("-h", StringComparer.OrdinalIgnoreCase))
{
    Console.WriteLine("""
        companion-ear — Path C WASAPI loopback → POST /ear
          companion-ear.exe --session ses_YOUR_ID
          companion-ear.exe --list
        Optional: --url https://rtp-teams.ntsa.uk --token <MEDIA_WORKER_SECRET> --chunk 2.5 --meeting "Standup"
        Token from MEDIA_WORKER_SECRET or media-host .env (not printed).
        Default session if omitted: ses_local (smoke test only).
        """);
    return;
}

if (args.Contains("--list", StringComparer.OrdinalIgnoreCase))
{
    ListDevices();
    return;
}

var url = Arg("--url") ?? Environment.GetEnvironmentVariable("EAR_URL") ?? "https://rtp-teams.ntsa.uk";
var session = Arg("--session") ?? Environment.GetEnvironmentVariable("EAR_SESSION") ?? "ses_local";
var token = Arg("--token") ?? Environment.GetEnvironmentVariable("MEDIA_WORKER_SECRET");
if (string.IsNullOrWhiteSpace(token))
{
    Console.Error.WriteLine("Missing MEDIA_WORKER_SECRET (env, --token, or media-host .env).");
    Environment.Exit(1);
}
var meetingArg = Arg("--meeting");
var deviceFilter = Arg("--device");
var seconds = double.TryParse(Arg("--chunk"), out var ch) ? ch : 8;

var taps = StartTaps(deviceFilter);
if (taps.Count == 0)
{
    Console.Error.WriteLine("""
        No playback devices to loopback. On Server/IONOS that is normal.
        Path C must run on the PC in the Teams meeting. Copy this folder there.
        """);
    Environment.Exit(2);
    return;
}

var logPath = Path.Combine(AppContext.BaseDirectory, "companion-ear.log");
try { File.WriteAllText(logPath, ""); } catch { /* first run */ }
var speaker = Environment.UserName;
EarLog(logPath, $"start machine={Environment.MachineName} session={session} url={url} taps={taps.Count} speaker={speaker}");

try { Console.Clear(); } catch { /* redirected */ }
Console.CursorVisible = false;
using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };
var spin = 0;
var frames = new[] { '|', '/', '-', '\\' };
var lastErr = "";
var lastHeard = "";
var lastHeardAt = DateTime.MinValue;
_ = Task.Run(async () =>
{
    try
    {
        while (!cts.IsCancellationRequested)
        {
            PaintStatus(frames[spin++ & 3], meetingArg, lastErr);
            await Task.Delay(90, cts.Token).ConfigureAwait(false);
        }
    }
    catch (OperationCanceledException) { }
});

var maxSamp = (int)(16_000 * Math.Clamp(seconds, 3, 12));
var minSamp = 16_000 * 2;       // do not flush clips shorter than 2s
var silenceNeed = 16_000 * 18 / 10; // 1.8s pause before we cut
var frame = new float[640];
var scratch = new float[640];
var acc = new List<float>(maxSamp);
var voiced = false;
var silence = 0;
var lastBeat = DateTime.UtcNow;

async Task PostWav(byte[] wav)
{
    try
    {
        var postSw = System.Diagnostics.Stopwatch.StartNew();
        using var res = await http.PostAsJsonAsync(
            $"{url.TrimEnd('/')}/ear",
            new { sessionId = session, wavBase64 = wav.Length == 0 ? "" : Convert.ToBase64String(wav) },
            cts.Token).ConfigureAwait(false);
        var body = await res.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false);
        postSw.Stop();
        lastErr = res.IsSuccessStatusCode ? "" : $"HTTP {(int)res.StatusCode}";
        string? heard = null;
        var sttMs = "-";
        var sttPath = "-";
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("text", out var t))
                heard = PhraseCanon.MaybeBar(t.GetString() ?? "");
            if (doc.RootElement.TryGetProperty("sttMs", out var sm)) sttMs = sm.ToString();
            if (doc.RootElement.TryGetProperty("sttPath", out var sp)) sttPath = sp.GetString() ?? "-";
        }
        catch { /* not json */ }
        EarLog(logPath, $"http={(int)res.StatusCode} postMs={postSw.ElapsedMilliseconds} wavBytes={wav.Length} sttMs={sttMs} path={sttPath} text={heard ?? "-"}");
        if (!string.IsNullOrWhiteSpace(heard))
        {
            if (DateTime.UtcNow - lastHeardAt < TimeSpan.FromSeconds(2.5) && lastHeard.Length > 0)
            {
                var a = lastHeard.Trim().TrimEnd('.');
                var b = heard.Trim();
                if (b.Length > 1) b = char.ToLowerInvariant(b[0]) + b[1..];
                heard = a + " " + b;
            }
            lastHeard = heard;
            lastHeardAt = DateTime.UtcNow;
            Console.WriteLine();
            Console.WriteLine($"{speaker}: {heard}");
        }
    }
    catch (Exception ex) when (ex is not OperationCanceledException)
    {
        lastErr = ex.GetType().Name;
        EarLog(logPath, $"error {ex.GetType().Name}: {ex.Message}");
        await Task.Delay(1000, cts.Token).ConfigureAwait(false);
    }
}

try
{
    while (!cts.IsCancellationRequested)
    {
        Array.Clear(frame);
        var nmax = 0;
        foreach (var tap in taps)
        {
            var n = tap.Chain.Read(scratch, 0, scratch.Length);
            if (n > nmax) nmax = n;
            for (var i = 0; i < n; i++) frame[i] += scratch[i];
        }
        if (nmax == 0)
        {
            await Task.Delay(20, cts.Token).ConfigureAwait(false);
            if (!voiced && DateTime.UtcNow - lastBeat > TimeSpan.FromSeconds(8))
            {
                await PostWav(Array.Empty<byte>()).ConfigureAwait(false);
                lastBeat = DateTime.UtcNow;
            }
            continue;
        }
        double e = 0;
        for (var i = 0; i < nmax; i++) e += frame[i] * frame[i];
        var speech = Math.Sqrt(e / nmax) > 0.016;
        if (speech)
        {
            voiced = true;
            silence = 0;
        }
        else if (voiced) silence += nmax;
        if (voiced)
        {
            for (var i = 0; i < nmax && acc.Count < maxSamp; i++) acc.Add(frame[i]);
        }
        var flush = voiced && ((silence >= silenceNeed && acc.Count >= minSamp) || acc.Count >= maxSamp);
        if (flush)
        {
            var pcm = new byte[acc.Count * 2];
            for (var i = 0; i < acc.Count; i++)
            {
                var s = (short)Math.Clamp(acc[i] * 32767f, short.MinValue, short.MaxValue);
                pcm[i * 2] = (byte)(s & 0xff);
                pcm[i * 2 + 1] = (byte)((s >> 8) & 0xff);
            }
            acc.Clear();
            voiced = false;
            silence = 0;
            lastBeat = DateTime.UtcNow;
            var audioMs = pcm.Length / 32;
            EarLog(logPath, $"flush audioMs={audioMs} samples={pcm.Length / 2}");
            if (audioMs < 1800)
                await PostWav(Array.Empty<byte>()).ConfigureAwait(false);
            else
                await PostWav(PcmWav.Wrap16kMono(pcm)).ConfigureAwait(false);
        }
        else if (!voiced && DateTime.UtcNow - lastBeat > TimeSpan.FromSeconds(8))
        {
            lastBeat = DateTime.UtcNow;
            await PostWav(Array.Empty<byte>()).ConfigureAwait(false);
        }
        await Task.Delay(15, cts.Token).ConfigureAwait(false);
    }
}
catch (OperationCanceledException)
{
    /* Ctrl+C */
}
finally
{
    foreach (var tap in taps)
    {
        try { tap.Capture.Dispose(); } catch { }
    }
    Console.CursorVisible = true;
    Console.WriteLine();
}

static void PaintStatus(char spin, string? meetingArg, string lastErr)
{
    string line;
    if (!TeamsRunning())
        line = $"Waiting for Teams on {Environment.MachineName}... {spin}";
    else
        line = $"Listening to {meetingArg ?? TeamsMeetingName() ?? "Teams"}... {spin}";
    if (!string.IsNullOrEmpty(lastErr))
        line += $"  ({lastErr})";
    if (line.Length < 80) line = line.PadRight(80);
    Console.Write('\r');
    Console.Write(line);
}

static bool TeamsRunning()
{
    foreach (var n in new[] { "ms-teams", "Teams" })
    {
        if (Process.GetProcessesByName(n).Length > 0) return true;
    }
    return false;
}

static string? TeamsMeetingName()
{
    foreach (var n in new[] { "ms-teams", "Teams" })
    {
        foreach (var p in Process.GetProcessesByName(n))
        {
            var t = p.MainWindowTitle?.Trim();
            if (string.IsNullOrEmpty(t)) continue;
            var cut = t.Split('|', '—')[0].Trim();
            if (cut.Length == 0) continue;
            if (cut.Equals("Microsoft Teams", StringComparison.OrdinalIgnoreCase)
                || cut.Equals("Teams", StringComparison.OrdinalIgnoreCase))
                continue;
            return cut;
        }
    }
    return null;
}

static List<(IDisposable Capture, ISampleProvider Chain)> StartTaps(string? filter)
{
    var taps = new List<(IDisposable, ISampleProvider)>();
    try
    {
        var en = new MMDeviceEnumerator();
        void Add(MMDevice d, bool loopback)
        {
            if (!string.IsNullOrEmpty(filter)
                && d.FriendlyName.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0)
                return;
            try
            {
                WasapiCapture cap = loopback ? new WasapiLoopbackCapture(d) : new WasapiCapture(d);
                var buf = new BufferedWaveProvider(cap.WaveFormat)
                {
                    DiscardOnBufferOverflow = true,
                    BufferDuration = TimeSpan.FromSeconds(10),
                };
                cap.DataAvailable += (_, e) =>
                {
                    if (e.BytesRecorded > 0) buf.AddSamples(e.Buffer, 0, e.BytesRecorded);
                };
                cap.StartRecording();
                ISampleProvider sp = buf.ToSampleProvider();
                if (cap.WaveFormat.Channels > 1)
                    sp = new StereoToMonoSampleProvider(sp);
                if (cap.WaveFormat.SampleRate != 16_000)
                    sp = new WdlResamplingSampleProvider(sp, 16_000);
                taps.Add((cap, sp));
            }
            catch { /* skip */ }
        }
        if (!string.IsNullOrEmpty(filter))
        {
            foreach (var d in en.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
                Add(d, loopback: true);
            foreach (var d in en.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
                Add(d, loopback: false);
        }
        else
        {
            // Default: speakers + mic only. Mixing every endpoint muddies STT.
            try { Add(en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia), true); } catch { }
            try { Add(en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications), false); } catch { }
            if (taps.Count == 0)
                try { Add(en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia), false); } catch { }
        }
    }
    catch { }
    return taps;
}

static void EarLog(string path, string line)
{
    try
    {
        File.AppendAllText(path, DateTime.UtcNow.ToString("o") + " " + line + Environment.NewLine);
    }
    catch { /* never crash the ear for logging */ }
}

static void ListDevices()
{
    try
    {
        var en = new NAudio.CoreAudioApi.MMDeviceEnumerator();
        foreach (var d in en.EnumerateAudioEndPoints(NAudio.CoreAudioApi.DataFlow.Render, NAudio.CoreAudioApi.DeviceState.Active))
            Console.WriteLine($"render\t{d.FriendlyName}");
        foreach (var d in en.EnumerateAudioEndPoints(NAudio.CoreAudioApi.DataFlow.Capture, NAudio.CoreAudioApi.DeviceState.Active))
            Console.WriteLine($"capture\t{d.FriendlyName}");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"no WASAPI endpoints ({ex.GetType().Name}). This host has no playback device.");
    }
}

static void LoadNearbyDotEnv()
{
    foreach (var path in new[]
    {
        Path.Combine(AppContext.BaseDirectory, ".env"),
        @"C:\TeamsConnector-publish\media-host\.env",
        Path.Combine(AppContext.BaseDirectory, "..", "media-host", ".env"),
    })
    {
        try
        {
            if (!File.Exists(path)) continue;
            foreach (var raw in File.ReadAllLines(path))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith('#') || !line.Contains('=')) continue;
                var i = line.IndexOf('=');
                var key = line[..i].Trim();
                var val = line[(i + 1)..].Trim().Trim('"');
                if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
                    Environment.SetEnvironmentVariable(key, val);
            }
        }
        catch { /* optional */ }
    }
}

string? Arg(string name)
{
    var i = Array.FindIndex(args, a => string.Equals(a, name, StringComparison.OrdinalIgnoreCase));
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}
