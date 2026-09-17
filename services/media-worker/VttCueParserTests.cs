using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class VttCueParserTests
{
    [Fact]
    public void ParsesVoiceTagAndTime()
    {
        var vtt = """
WEBVTT

00:00:01.000 --> 00:00:03.500
<v Simon Barnett>The test phrase is mirror-44</v>
""";
        var cues = VttCueParser.Parse(vtt);
        Assert.Single(cues);
        Assert.Equal("Simon Barnett", cues[0].Speaker);
        Assert.Equal("The test phrase is mirror-44", cues[0].Text);
        Assert.Equal(1000, cues[0].TMs);
        Assert.Equal(3500, cues[0].EndMs);
    }
}
