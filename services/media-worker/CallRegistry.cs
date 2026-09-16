using System.Collections.Concurrent;

namespace TeamsAudioJoin.MediaWorker;

public enum CallLifecycle
{
    Establishing,
    Established,
    Terminated,
}

public sealed class CallRegistry
{
    private readonly ConcurrentDictionary<string, Entry> _bySession = new();
    private readonly ConcurrentDictionary<string, string> _sessionByCall = new();

    public void Track(string sessionId, string callId)
    {
        _bySession[sessionId] = new Entry { CallId = callId, State = CallLifecycle.Establishing };
        _sessionByCall[callId] = sessionId;
    }

    public bool TryGetCall(string sessionId, out string callId)
    {
        if (_bySession.TryGetValue(sessionId, out var e))
        {
            callId = e.CallId;
            return true;
        }
        callId = "";
        return false;
    }

    public bool TryGetSession(string callId, out string sessionId) =>
        _sessionByCall.TryGetValue(callId, out sessionId!);

    public void SetState(string sessionId, CallLifecycle state)
    {
        _bySession.AddOrUpdate(sessionId, _ => new Entry { CallId = "", State = state }, (_, e) =>
        {
            e.State = state;
            return e;
        });
    }

    public CallLifecycle? GetState(string sessionId) =>
        _bySession.TryGetValue(sessionId, out var e) ? e.State : null;

    public bool CanPlay(string sessionId) =>
        _bySession.TryGetValue(sessionId, out var e) && e.State == CallLifecycle.Established;

    public void SetActivePrompt(string sessionId, string utteranceId)
    {
        if (_bySession.TryGetValue(sessionId, out var e)) e.ActiveUtteranceId = utteranceId;
    }

    public bool TryTakeActivePrompt(string sessionId, string? utteranceId, out string taken)
    {
        taken = "";
        if (!_bySession.TryGetValue(sessionId, out var e) || string.IsNullOrEmpty(e.ActiveUtteranceId))
        {
            return false;
        }
        if (!string.IsNullOrEmpty(utteranceId) && e.ActiveUtteranceId != utteranceId)
        {
            return false;
        }
        taken = e.ActiveUtteranceId;
        e.ActiveUtteranceId = null;
        return true;
    }

    public void ClearActivePrompt(string sessionId)
    {
        if (_bySession.TryGetValue(sessionId, out var e)) e.ActiveUtteranceId = null;
    }

    public void Remove(string sessionId)
    {
        if (_bySession.TryRemove(sessionId, out var e))
        {
            _sessionByCall.TryRemove(e.CallId, out _);
        }
    }

    private sealed class Entry
    {
        public string CallId { get; set; } = "";
        public CallLifecycle State { get; set; }
        public string? ActiveUtteranceId { get; set; }
    }
}
