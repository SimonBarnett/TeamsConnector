using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class GraphJoinTests
{
    [Fact]
    public void ParsesThreadIdFromRedactedJoinUrl()
    {
        var url = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0";
        Assert.Equal("19:meeting_abc@thread.v2", GraphJoinClient.ThreadIdFromJoinUrl(url));
    }
}
