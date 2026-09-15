namespace TeamsAudioJoin.MediaWorker;

public enum MediaDirection
{
    Sendonly,
    Recvonly,
    Sendrecv,
}

public sealed record MediaSocketPlan(
    string Kind,
    MediaDirection Direction,
    int? Width = null,
    int? Height = null,
    bool Vbss = false);

/// <summary>
/// Declares sockets for a Graph local media session. Video is send-only.
/// Never add Recvonly/Sendrecv video or VBSS — inbound camera is out of scope.
/// </summary>
public static class MediaSessionPlan
{
    public const int AvatarWidth = 640;
    public const int AvatarHeight = 360;
    public const double AvatarFps = 7.5;

    public static IReadOnlyList<MediaSocketPlan> ForListenWithAvatar() =>
    [
        new("audio", MediaDirection.Recvonly),
        new("video", MediaDirection.Sendonly, AvatarWidth, AvatarHeight),
    ];

    public static IReadOnlyList<MediaSocketPlan> ForListenSpeakWithAvatar() =>
    [
        new("audio", MediaDirection.Sendrecv),
        new("video", MediaDirection.Sendonly, AvatarWidth, AvatarHeight),
    ];

    public static IReadOnlyList<MediaSocketPlan> ForListenAudioOnly() =>
    [
        new("audio", MediaDirection.Recvonly),
    ];

    public static void EnsureNoInboundVideo(IEnumerable<MediaSocketPlan> sockets)
    {
        foreach (var socket in sockets)
        {
            if (socket.Vbss)
            {
                throw new InvalidOperationException("VBSS/screen-share sockets are not allowed.");
            }

            if (socket.Kind == "video" && socket.Direction != MediaDirection.Sendonly)
            {
                throw new InvalidOperationException("Inbound video sockets are not allowed.");
            }
        }
    }
}
