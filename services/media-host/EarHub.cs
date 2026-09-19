using System.Collections.Concurrent;

namespace TeamsAudioJoin.MediaHost;

/// <summary>Path C companion heartbeat + last STT cue. Not Graph AccessMedia.</summary>
public sealed class EarHub
{
    public static readonly TimeSpan HeartbeatTtl = TimeSpan.FromSeconds(15);
    private readonly ConcurrentDictionary<string, State> _bySession = new(StringComparer.Ordinal);

    public void Touch(string sessionId)
    {
        var s = _bySession.GetOrAdd(sessionId, _ => new State());
        lock (s) { s.LastSeenUtc = DateTime.UtcNow; }
    }

    public void AddCue(string sessionId, string text)
    {
        text = TeamsAudioJoin.MediaWorker.PhraseCanon.MaybeBar(text);
        var s = _bySession.GetOrAdd(sessionId, _ => new State());
        lock (s)
        {
            s.LastSeenUtc = DateTime.UtcNow;
            if (s.Cues.Count > 0 && DateTime.UtcNow - s.Cues[^1].Utc < TimeSpan.FromSeconds(2.5))
            {
                var prev = s.Cues[^1];
                var joined = TeamsAudioJoin.MediaWorker.PhraseCanon.MaybeBar(JoinUtterance(prev.Text, text));
                s.Cues[^1] = new EarCue(prev.Utc, joined);
                s.LastText = joined;
            }
            else
            {
                s.LastText = text;
                s.Cues.Add(new EarCue(DateTime.UtcNow, text));
            }
            if (s.Cues.Count > 50) s.Cues.RemoveRange(0, s.Cues.Count - 50);
        }
    }

    public EarSnapshot Snapshot(string sessionId)
    {
        if (!_bySession.TryGetValue(sessionId, out var s))
        {
            return new EarSnapshot(false, null, Array.Empty<EarCue>(), null);
        }
        lock (s)
        {
            var live = DateTime.UtcNow - s.LastSeenUtc < HeartbeatTtl;
            return new EarSnapshot(live, s.LastText, s.Cues.ToArray(), s.LastSeenUtc);
        }
    }

    private static string JoinUtterance(string a, string b)
    {
        a = a.Trim();
        b = b.Trim();
        if (a.EndsWith('.')) a = a[..^1];
        if (b.Length == 1) b = char.ToLowerInvariant(b[0]).ToString();
        else if (b.Length > 1) b = char.ToLowerInvariant(b[0]) + b[1..];
        return a + " " + b;
    }

    private sealed class State
    {
        public DateTime LastSeenUtc;
        public string? LastText;
        public List<EarCue> Cues { get; } = new();
    }
}

public sealed record EarCue(DateTime Utc, string Text);

public sealed record EarSnapshot(bool CanHear, string? LastText, EarCue[] Cues, DateTime? LastSeenUtc);
