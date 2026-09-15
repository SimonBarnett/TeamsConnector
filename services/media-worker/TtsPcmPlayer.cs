namespace TeamsAudioJoin.MediaWorker;

/// <summary>
/// Outbound TTS as 20 ms PCM16 16 kHz mono frames. Cancel/barge-in stops
/// at the next frame boundary (≤ 20 ms, well under the 400 ms SLA).
/// Frames stay in memory; nothing is written to disk.
/// </summary>
public sealed class TtsPcmPlayer : IDisposable
{
    public const int SampleRate = 16_000;
    public const int FrameMs = 20;
    public const int BytesPerSample = 2;
    public static readonly int FrameBytes = SampleRate * BytesPerSample * FrameMs / 1000;

    private readonly object _gate = new();
    private byte[]? _pcm;
    private int _offset;
    private bool _playing;
    private string? _utteranceId;
    private DateTime _startedUtc;
    private DateTime _stoppedUtc;

    public bool Playing
    {
        get { lock (_gate) return _playing; }
    }

    public string? UtteranceId
    {
        get { lock (_gate) return _utteranceId; }
    }

    public TimeSpan StopLatency
    {
        get { lock (_gate) return _stoppedUtc - _startedUtc; }
    }

    public void Start(string utteranceId, byte[] pcm16k)
    {
        lock (_gate)
        {
            _pcm = pcm16k;
            _offset = 0;
            _utteranceId = utteranceId;
            _playing = true;
            _startedUtc = DateTime.UtcNow;
        }
    }

    /// <summary>Pull the next 20 ms frame. Empty span means idle/cancelled.</summary>
    public bool TryReadFrame(Span<byte> dest)
    {
        lock (_gate)
        {
            if (!_playing || _pcm is null)
            {
                dest.Clear();
                return false;
            }

            var remaining = _pcm.Length - _offset;
            var n = Math.Min(FrameBytes, remaining);
            if (n <= 0)
            {
                _playing = false;
                _stoppedUtc = DateTime.UtcNow;
                dest.Clear();
                return false;
            }

            _pcm.AsSpan(_offset, n).CopyTo(dest);
            if (n < dest.Length) dest[n..].Clear();
            _offset += n;
            return true;
        }
    }

    public string? Cancel()
    {
        lock (_gate)
        {
            if (!_playing) return null;
            var id = _utteranceId;
            _playing = false;
            _pcm = null;
            _stoppedUtc = DateTime.UtcNow;
            return id;
        }
    }

    public void Dispose() => Cancel();
}
