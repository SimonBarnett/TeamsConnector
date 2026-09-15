namespace TeamsAudioJoin.MediaWorker;

/// <summary>
/// Repeats one NV12 still at 7.5 fps. The send callback is the Graph video socket
/// in production; tests inject a counter. No frames are written to disk.
/// </summary>
public sealed class StillAvatarLoop : IDisposable
{
    private readonly byte[] _nv12;
    private readonly Action<byte[]> _send;
    private readonly TimeSpan _period;
    private CancellationTokenSource? _cts;
    private Task? _run;
    private int _framesSent;

    public StillAvatarLoop(byte[] nv12, Action<byte[]> send, double fps = MediaSessionPlan.AvatarFps)
    {
        _nv12 = nv12;
        _send = send;
        _period = TimeSpan.FromSeconds(1d / fps);
    }

    public bool Sending => _cts is { IsCancellationRequested: false };
    public int FramesSent => Volatile.Read(ref _framesSent);

    public void Start()
    {
        if (_cts != null) return;
        _cts = new CancellationTokenSource();
        var token = _cts.Token;
        _run = Task.Run(async () =>
        {
            while (!token.IsCancellationRequested)
            {
                _send(_nv12);
                Interlocked.Increment(ref _framesSent);
                try
                {
                    await Task.Delay(_period, token).ConfigureAwait(false);
                }
                catch (TaskCanceledException)
                {
                    break;
                }
            }
        }, token);
    }

    public void Stop()
    {
        _cts?.Cancel();
        try
        {
            _run?.GetAwaiter().GetResult();
        }
        catch (TaskCanceledException)
        {
            // expected
        }
        _cts?.Dispose();
        _cts = null;
        _run = null;
    }

    public void Dispose() => Stop();
}
