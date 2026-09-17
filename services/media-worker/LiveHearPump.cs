namespace TeamsAudioJoin.MediaWorker;

/// <summary>
/// Snapshots the recv PCM ring every few seconds, STTs when there is energy,
/// and raises finals. No-op until frames are pushed (AccessMedia / media SDK).
/// </summary>
public sealed class LiveHearPump : IDisposable
{
    private readonly AudioRingBuffer _ring;
    private readonly AzureStt _stt;
    private readonly Func<string, Task> _onFinal;
    private readonly CancellationTokenSource _cts = new();
    private string _last = "";

    public LiveHearPump(AudioRingBuffer ring, AzureStt stt, Func<string, Task> onFinal)
    {
        _ring = ring;
        _stt = stt;
        _onFinal = onFinal;
        _ = Task.Run(LoopAsync);
    }

    private async Task LoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(2), _cts.Token).ConfigureAwait(false);
                var pcm = _ring.Snapshot();
                if (!PcmWav.HasEnergy(pcm)) continue;
                var wav = PcmWav.Wrap16kMono(pcm);
                var text = await _stt.RecognizeWavAsync(wav, _cts.Token).ConfigureAwait(false);
                if (string.IsNullOrWhiteSpace(text) || string.Equals(text, _last, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                _last = text;
                await _onFinal(text).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                /* next tick */
            }
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _cts.Dispose();
    }
}
