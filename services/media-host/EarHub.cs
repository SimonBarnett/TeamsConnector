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
        var s = _bySession.GetOrAdd(sessionId, _ => new State());
        lock (s)
        {
            s.LastSeenUtc = DateTime.UtcNow;
            s.LastText = text;
            s.Cues.Add(new EarCue(DateTime.UtcNow, text));
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

    private sealed class State
    {
        public DateTime LastSeenUtc;
        public string? LastText;
        public List<EarCue> Cues { get; } = new();
    }
}

public sealed record EarCue(DateTime Utc, string Text);

public sealed record EarSnapshot(bool CanHear, string? LastText, EarCue[] Cues, DateTime? LastSeenUtc);
