using System.Collections.Concurrent;

namespace TeamsAudioJoin.MediaWorker;

/// <summary>
/// WAV blobs Graph GET at /prompts/{guid}.wav. Ids are GUIDs (not utterance ids).
/// Deleted on playCompleted and swept after <see cref="Ttl"/>.
/// </summary>
public sealed class PromptStore
{
    public static readonly TimeSpan Ttl = TimeSpan.FromMinutes(2);

    private readonly ConcurrentDictionary<string, Entry> _byId = new();
    private readonly ConcurrentDictionary<string, string> _idByUtterance = new();

    public string Put(string utteranceId, byte[] wav, DateTimeOffset now)
    {
        var id = Guid.NewGuid().ToString("N");
        _byId[id] = new Entry { Wav = wav, UtteranceId = utteranceId, StoredAt = now };
        _idByUtterance[utteranceId] = id;
        return id;
    }

    public bool TryGet(string id, out byte[] wav)
    {
        wav = Array.Empty<byte>();
        if (!_byId.TryGetValue(id, out var e)) return false;
        wav = e.Wav;
        return true;
    }

    public string? IdForUtterance(string utteranceId) =>
        _idByUtterance.TryGetValue(utteranceId, out var id) ? id : null;

    public void Complete(string? utteranceId)
    {
        if (string.IsNullOrEmpty(utteranceId)) return;
        if (_idByUtterance.TryRemove(utteranceId, out var id))
        {
            _byId.TryRemove(id, out _);
        }
    }

    public int Sweep(DateTimeOffset now)
    {
        var n = 0;
        foreach (var kv in _byId)
        {
            if (now - kv.Value.StoredAt < Ttl) continue;
            if (_byId.TryRemove(kv.Key, out var e))
            {
                _idByUtterance.TryRemove(e.UtteranceId, out _);
                n++;
            }
        }
        return n;
    }

    private sealed class Entry
    {
        public required byte[] Wav { get; init; }
        public required string UtteranceId { get; init; }
        public required DateTimeOffset StoredAt { get; init; }
    }
}
