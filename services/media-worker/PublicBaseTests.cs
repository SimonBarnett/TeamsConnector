using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class PublicBaseTests
{
    [Fact]
    public void LoopbackAndEmptyAreNotPublic()
    {
        Assert.True(PublicBase.IsLoopback(null));
        Assert.True(PublicBase.IsLoopback(""));
        Assert.True(PublicBase.IsLoopback("http://127.0.0.1:7071"));
        Assert.True(PublicBase.IsLoopback("http://localhost:7071"));
        Assert.True(PublicBase.IsLoopback("http://[::1]/"));
        Assert.False(PublicBase.IsLoopback("https://king-ended-celebrate-class.trycloudflare.com"));
    }
}
