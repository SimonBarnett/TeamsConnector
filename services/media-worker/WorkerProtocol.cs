namespace TeamsAudioJoin.MediaWorker;

public sealed record JoinCommand(string SessionId, string JoinUrlRedacted, string Locale);

public sealed record LeaveCommand(string SessionId);

public sealed record HealthStatus(bool Healthy, string Plane = "media");

/// <summary>
/// Orchestrator ↔ worker contract for the Phase 0 spike.
/// Join by URL is performed with Graph communications createCall on Windows.
/// This assembly does not persist media and does not implement TTS.
/// </summary>
public interface IMediaWorker
{
    Task<HealthStatus> HealthAsync(CancellationToken cancellationToken = default);
    Task JoinAsync(JoinCommand command, CancellationToken cancellationToken = default);
    Task LeaveAsync(LeaveCommand command, CancellationToken cancellationToken = default);
}

public sealed class UnconfiguredMediaWorker : IMediaWorker
{
    public Task<HealthStatus> HealthAsync(CancellationToken cancellationToken = default)
        => Task.FromResult(new HealthStatus(false));

    public Task JoinAsync(JoinCommand command, CancellationToken cancellationToken = default)
        => throw new InvalidOperationException(
            "Track B is not configured. Calls.AccessMedia.All is not requested in Phase 1.");

    public Task LeaveAsync(LeaveCommand command, CancellationToken cancellationToken = default)
        => Task.CompletedTask;
}
