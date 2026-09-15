namespace TeamsAudioJoin.MediaWorker;

/// <summary>
/// In-memory PCM ring buffer. Capacity is 10 seconds of 16 kHz 16-bit mono
/// (20 ms frames). Never writes WAV/PCM/Opus to disk.
/// </summary>
public sealed class AudioRingBuffer
{
    public const int SampleRate = 16_000;
    public const int FrameMs = 20;
    public const int MaxSeconds = 10;
    public const int BytesPerSample = 2;

    private readonly byte[] _buffer;
    private int _write;
    private int _filled;

    public AudioRingBuffer(int maxSeconds = MaxSeconds)
    {
        var bytes = SampleRate * BytesPerSample * maxSeconds;
        _buffer = new byte[bytes];
    }

    public int CapacityBytes => _buffer.Length;
    public int FilledBytes => _filled;

    public void PushFrame(ReadOnlySpan<byte> pcm16)
    {
        if (pcm16.Length == 0) return;
        var n = Math.Min(pcm16.Length, _buffer.Length);
        var src = pcm16[^n..];
        foreach (var b in src)
        {
            _buffer[_write] = b;
            _write = (_write + 1) % _buffer.Length;
            if (_filled < _buffer.Length) _filled++;
        }
    }

    public byte[] Snapshot()
    {
        var copy = new byte[_filled];
        if (_filled == 0) return copy;
        var start = (_write - _filled + _buffer.Length) % _buffer.Length;
        for (var i = 0; i < _filled; i++)
        {
            copy[i] = _buffer[(start + i) % _buffer.Length];
        }
        return copy;
    }
}
