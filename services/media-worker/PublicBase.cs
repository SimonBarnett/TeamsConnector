using System.Net;

namespace TeamsAudioJoin.MediaWorker;

/// <summary>Graph fetches playPrompt WAVs from PUBLIC_BASE_URL. Loopback is not reachable.</summary>
public static class PublicBase
{
    public static bool IsLoopback(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return true;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u)) return true;
        var host = u.Host.Trim('[', ']');
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return true;
        if (IPAddress.TryParse(host, out var ip) && IPAddress.IsLoopback(ip)) return true;
        return false;
    }
}
