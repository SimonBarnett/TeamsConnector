using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Graph.Communications.Calls;
using Microsoft.Graph.Communications.Calls.Media;
using Microsoft.Graph.Communications.Client;
using Microsoft.Graph.Communications.Client.Authentication;
using Microsoft.Graph.Communications.Common.Telemetry;
using Microsoft.Graph.Communications.Resources;
using Microsoft.Graph.Contracts;
using Microsoft.Graph.Models;
using Microsoft.Identity.Client;
using Microsoft.Skype.Bots.Media;
using TeamsAudioJoin.MediaWorker;

namespace TeamsAudioJoin.MediaHost;

public sealed class HostedMediaRuntime : IDisposable
{
    private readonly ILogger _log;
    private readonly AzureStt? _stt;
    private readonly AzureTts? _tts;
    private readonly ConcurrentDictionary<string, HostedCall> _bySession = new();
    private readonly ConcurrentDictionary<string, string> _sessionByCall = new();
    private ICommunicationsClient? _client;
    private GraphLogger? _graphLog;

    public HostedMediaRuntime(ILogger log, AzureStt? stt, AzureTts? tts)
    {
        _log = log;
        _stt = stt;
        _tts = tts;
    }

    public bool MediaReady { get; private set; }
    public string? InitError { get; private set; }
    public string? CertThumbprint { get; private set; }
    public string ServiceFqdn { get; private set; } = "";
    public string PublicIp { get; private set; } = "";
    public int PublicPort { get; private set; } = 8445;
    public int InternalPort { get; private set; } = 8445;
    public string CallbackUri { get; private set; } = "";
    public X509Certificate2? Certificate { get; private set; }

    public bool TryStart()
    {
        var tenant = Env("AZURE_TENANT_ID");
        var clientId = Env("AZURE_CLIENT_ID");
        var secret = Env("AZURE_CLIENT_SECRET");
        CallbackUri = Env("CALLBACK_URI") ?? Env("MEDIA_CALLBACK_URI") ?? "";
        ServiceFqdn = Env("MEDIA_SERVICE_FQDN") ?? "rtp-teams.ntsa.uk";
        PublicIp = Env("MEDIA_PUBLIC_IP") ?? "81.136.247.247";
        PublicPort = EnvInt("MEDIA_PUBLIC_PORT", 8445);
        InternalPort = EnvInt("MEDIA_INTERNAL_PORT", 8445);
        if (string.IsNullOrWhiteSpace(tenant) || string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(secret))
        {
            InitError = "AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET missing";
            return false;
        }
        if (string.IsNullOrWhiteSpace(CallbackUri) || PublicBase.IsLoopback(CallbackUri))
        {
            InitError = "CALLBACK_URI must be public HTTPS (Graph notifications)";
            return false;
        }

        Certificate = LoadCertificate(Env("MEDIA_CERT_THUMBPRINT"), ServiceFqdn);
        if (Certificate is null)
        {
            InitError = $"no certificate for {ServiceFqdn} (set MEDIA_CERT_THUMBPRINT or install a cert)";
            return false;
        }
        CertThumbprint = Certificate.Thumbprint;
        Trace.Listeners.Add(new System.Diagnostics.TextWriterTraceListener(GraphCallFileLog.Path) { Name = "graph-call" });
        Trace.AutoFlush = true;

        try
        {
            _graphLog = new GraphLogger("media-host", properties: null, redirectToTrace: true);
            var msal = ConfidentialClientApplicationBuilder.Create(clientId)
                .WithAuthority($"https://login.microsoftonline.com/{tenant}")
                .WithClientSecret(secret)
                .Build();
            var builder = new CommunicationsClientBuilder("teams-audio-join-media-host", clientId, _graphLog);
            builder.SetAuthentication(clientId, new MsalTokenProvider(msal));
            builder.SetNotificationUrl(new Uri(CallbackUri));
            builder.SetServiceBaseUrl(new Uri("https://graph.microsoft.com/v1.0"));
            if (!IPAddress.TryParse(PublicIp, out var publicIp))
            {
                publicIp = IPAddress.Any;
            }
            var instance = new MediaPlatformInstanceSettings
            {
                Certificate = Certificate,
                CertificateThumbprint = Certificate.Thumbprint,
                InstanceInternalPort = InternalPort,
                InstancePublicPort = PublicPort,
                InstancePublicIPAddress = publicIp,
                ServiceFqdn = ServiceFqdn,
            };
            builder.SetMediaPlatformSettings(new MediaPlatformSettings
            {
                ApplicationId = clientId,
                MediaPlatformInstanceSettings = instance,
            });
            _client = builder.Build();
            _client.Calls().OnUpdated += OnCallsUpdated;
            MediaReady = true;
            InitError = null;
            _log.LogInformation(
                "media platform ready fqdn={Fqdn} public={Ip}:{Port} thumb={Thumb}",
                ServiceFqdn, PublicIp, PublicPort, Certificate.Thumbprint);
            return true;
        }
        catch (Exception ex)
        {
            InitError = ex.GetBaseException().Message;
            _log.LogError(ex, "media platform init failed");
            return false;
        }
    }

    public async Task<string> JoinAsync(
        string sessionId,
        string? joinUrl,
        string? threadId,
        string? organizerId,
        string? tenantId,
        Func<string, Task> onTranscript,
        Action<string, bool>? onState = null,
        CancellationToken ct = default)
    {
        if (_client is null || !MediaReady)
        {
            throw new InvalidOperationException(InitError ?? "media platform not ready");
        }
        var thread = threadId
            ?? (string.IsNullOrEmpty(joinUrl) ? null : GraphJoinClient.ThreadIdFromJoinUrl(joinUrl));
        if (string.IsNullOrEmpty(thread))
        {
            throw new InvalidOperationException("joinUrl did not contain a 19: meeting thread id");
        }
        if (string.IsNullOrEmpty(organizerId) || string.IsNullOrEmpty(tenantId))
        {
            throw new InvalidOperationException("organizerId and tenantId are required for application-hosted join");
        }

        var mediaSession = _client.CreateMediaSession(
            new AudioSocketSettings
            {
                StreamDirections = StreamDirection.Sendrecv,
                SupportedAudioFormat = AudioFormat.Pcm16K,
                ReceiveUnmixedMeetingAudio = false,
            },
            Array.Empty<VideoSocketSettings>(),
            vbssSocketSettings: null!,
            dataSocketSettings: null!);

        var audio = mediaSession.AudioSocket
            ?? throw new InvalidOperationException("CreateMediaSession returned no audio socket");

        var ring = new AudioRingBuffer();
        var player = new TtsPcmPlayer();
        LiveHearPump? pump = null;
        if (_stt is not null)
        {
            pump = new LiveHearPump(ring, _stt, onTranscript);
        }

        var hosted = new HostedCall(sessionId, mediaSession, audio, ring, player, pump)
        {
            OnState = onState,
        };
        audio.AudioMediaReceived += hosted.OnAudioReceived;
        audio.AudioSendStatusChanged += hosted.OnSendStatus;
        hosted.StartSendLoop();

        var user = new Identity { Id = organizerId };
        user.SetTenantId(tenantId);
        var joinParams = new JoinMeetingParameters(
            new ChatInfo { ThreadId = thread, MessageId = "0" },
            new OrganizerMeetingInfo
            {
                Organizer = new IdentitySet { User = user },
                AdditionalData = new Dictionary<string, object> { ["allowConversationWithoutHost"] = true },
            },
            mediaSession)
        {
            TenantId = tenantId,
        };

        ICall call;
        try
        {
            call = await _client.Calls().AddAsync(joinParams, Guid.NewGuid(), ct).ConfigureAwait(false);
        }
        catch
        {
            hosted.Dispose();
            throw;
        }

        hosted.Call = call;
        call.OnUpdated += hosted.OnCallUpdated;
        _bySession[sessionId] = hosted;
        _sessionByCall[call.Id] = sessionId;
        if (call.Resource?.State == CallState.Established)
        {
            hosted.Established = true;
            hosted.OnState?.Invoke(sessionId, true);
        }
        _log.LogInformation("joined session={Session} call={Call} thread={Thread}", sessionId, call.Id, thread);
        return call.Id;
    }

    public bool TryGetCall(string sessionId, out HostedCall call) => _bySession.TryGetValue(sessionId, out call!);

    public bool TryGetSession(string callId, out string sessionId) => _sessionByCall.TryGetValue(callId, out sessionId!);

    public async Task PlayAsync(string sessionId, string utteranceId, string text, CancellationToken ct = default)
    {
        if (!TryGetCall(sessionId, out var hosted))
        {
            throw new InvalidOperationException("session not in a Graph call");
        }
        if (_tts is null)
        {
            throw new InvalidOperationException("AZURE_SPEECH_KEY is required; refusing to play silence");
        }
        var wav = await _tts.SynthesizeWavAsync(text, ct).ConfigureAwait(false);
        if (AzureTts.IsSilentPcm(wav))
        {
            throw new InvalidOperationException("refusing silent WAV");
        }
        var pcm = wav.Length > 44 && wav[0] == (byte)'R' ? wav.AsSpan(44).ToArray() : wav;
        hosted.Player.Start(utteranceId, pcm);
    }

    public string? CancelPlay(string sessionId) =>
        TryGetCall(sessionId, out var hosted) ? hosted.Player.Cancel() : null;

    public async Task LeaveAsync(string sessionId)
    {
        if (!_bySession.TryRemove(sessionId, out var hosted)) return;
        if (hosted.Call is not null)
        {
            _sessionByCall.TryRemove(hosted.Call.Id, out _);
            try { await hosted.Call.DeleteAsync().ConfigureAwait(false); }
            catch { /* best-effort hangup */ }
        }
        hosted.Dispose();
    }

    public async Task<HttpResponseMessage> ProcessNotificationAsync(HttpRequestMessage request)
    {
        if (_client is null)
        {
            return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
        }
        return await _client.ProcessNotificationAsync(request).ConfigureAwait(false);
    }

    public IReadOnlyList<(string SessionId, string CallId)> Snapshot() =>
        _bySession.Select(kv => (kv.Key, kv.Value.Call?.Id ?? "")).ToList();

    public void Dispose()
    {
        foreach (var id in _bySession.Keys.ToArray())
        {
            try { LeaveAsync(id).GetAwaiter().GetResult(); }
            catch { /* shutdown */ }
        }
        _client?.Dispose();
        _graphLog = null;
    }

    private void OnCallsUpdated(ICallCollection sender, CollectionEventArgs<ICall> args)
    {
        foreach (var call in args.RemovedResources)
        {
            if (_sessionByCall.TryRemove(call.Id, out var sessionId)
                && _bySession.TryRemove(sessionId, out var hosted))
            {
                hosted.Terminated = true;
                hosted.Dispose();
            }
        }
    }

    internal static X509Certificate2? LoadCertificate(string? thumbprint, string fqdn)
    {
        if (!string.IsNullOrWhiteSpace(thumbprint))
        {
            var byThumb = Find(StoreLocation.LocalMachine, X509FindType.FindByThumbprint, thumbprint)
                ?? Find(StoreLocation.CurrentUser, X509FindType.FindByThumbprint, thumbprint);
            if (byThumb is not null) return byThumb;
        }
        return Find(StoreLocation.LocalMachine, X509FindType.FindBySubjectName, fqdn)
            ?? Find(StoreLocation.CurrentUser, X509FindType.FindBySubjectName, fqdn);
    }

    private static X509Certificate2? Find(StoreLocation loc, X509FindType type, string value)
    {
        using var store = new X509Store(StoreName.My, loc);
        store.Open(OpenFlags.ReadOnly);
        foreach (X509Certificate2 cert in store.Certificates)
        {
            var match = type == X509FindType.FindByThumbprint
                ? cert.Thumbprint.Equals(value, StringComparison.OrdinalIgnoreCase)
                : cert.Subject.IndexOf(value, StringComparison.OrdinalIgnoreCase) >= 0;
            if (match && cert.HasPrivateKey)
            {
                return new X509Certificate2(cert);
            }
        }
        return null;
    }

    private static string? Env(string name)
    {
        var v = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrWhiteSpace(v) ? null : v.Trim();
    }

    private static int EnvInt(string name, int fallback) =>
        int.TryParse(Environment.GetEnvironmentVariable(name), out var n) ? n : fallback;
}

public sealed class HostedCall : IDisposable
{
    private readonly CancellationTokenSource _cts = new();
    private int _disposed;

    public HostedCall(
        string sessionId,
        ILocalMediaSession media,
        IAudioSocket audio,
        AudioRingBuffer ring,
        TtsPcmPlayer player,
        LiveHearPump? pump)
    {
        SessionId = sessionId;
        Media = media;
        Audio = audio;
        Ring = ring;
        Player = player;
        Pump = pump;
    }

    public string SessionId { get; }
    public ILocalMediaSession Media { get; }
    public IAudioSocket Audio { get; }
    public AudioRingBuffer Ring { get; }
    public TtsPcmPlayer Player { get; }
    public LiveHearPump? Pump { get; }
    public ICall? Call { get; set; }
    public bool SendActive { get; private set; }
    public bool Established { get; set; }
    public bool Terminated { get; set; }
    public Action<string, bool>? OnState { get; set; }

    public void StartSendLoop() => _ = Task.Run(SendLoopAsync);

    public void OnAudioReceived(object? sender, AudioMediaReceivedEventArgs e)
    {
        try
        {
            if (e.Buffer.IsSilence || Player.Playing) return;
            var len = (int)e.Buffer.Length;
            if (len <= 0 || e.Buffer.Data == IntPtr.Zero) return;
            var pcm = new byte[len];
            Marshal.Copy(e.Buffer.Data, pcm, 0, len);
            Ring.PushFrame(pcm);
        }
        finally
        {
            e.Buffer.Dispose();
        }
    }

    public void OnSendStatus(object? sender, AudioSendStatusChangedEventArgs e)
    {
        SendActive = e.MediaSendStatus == MediaSendStatus.Active;
    }

    public void OnCallUpdated(ICall sender, ResourceEventArgs<Call> args)
    {
        var state = sender.Resource?.State;
        var info = sender.Resource?.ResultInfo;
        System.Diagnostics.Trace.TraceInformation(
            "call {0} session {1} state={2} result={3}",
            sender.Id, SessionId, state, info?.Message);
        GraphCallFileLog.Line(
            $"call {sender.Id} session {SessionId} state={state} resultCode={info?.Code} resultSubcode={info?.Subcode} result={info?.Message}");
        if (state == CallState.Established)
        {
            Established = true;
            OnState?.Invoke(SessionId, true);
        }
        else if (state is CallState.Terminated or CallState.Terminating)
        {
            Terminated = true;
            OnState?.Invoke(SessionId, false);
        }
    }

    private async Task SendLoopAsync()
    {
        var frame = new byte[TtsPcmPlayer.FrameBytes];
        var silence = new byte[TtsPcmPlayer.FrameBytes];
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(20));
        try
        {
            while (await timer.WaitForNextTickAsync(_cts.Token).ConfigureAwait(false))
            {
                if (!SendActive) continue;
                var has = Player.TryReadFrame(frame);
                var payload = has ? frame : silence;
                Audio.Send(new PcmSendBuffer(payload, MediaPlatform.GetCurrentTimestamp()));
            }
        }
        catch (OperationCanceledException)
        {
            /* leave */
        }
        catch
        {
            /* socket gone */
        }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 1) return;
        _cts.Cancel();
        Audio.AudioMediaReceived -= OnAudioReceived;
        Audio.AudioSendStatusChanged -= OnSendStatus;
        if (Call is not null) Call.OnUpdated -= OnCallUpdated;
        Pump?.Dispose();
        Player.Dispose();
        _cts.Dispose();
    }
}
