using TeamsAudioJoin.MediaHost;
using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class EarHubTests
{
    [Fact]
    public void CompanionOff_CanHearFalse()
    {
        var ear = new EarHub();
        var snap = ear.Snapshot("ses_x");
        Assert.False(snap.CanHear);
        Assert.Null(snap.LastText);
    }

    [Fact]
    public void Heartbeat_CanHearTrue_CueStored()
    {
        var ear = new EarHub();
        ear.Touch("ses_x");
        ear.AddCue("ses_x", "the test phrase is mirror-44");
        var snap = ear.Snapshot("ses_x");
        Assert.True(snap.CanHear);
        Assert.Equal("the test phrase is mirror-44", snap.LastText);
        Assert.Single(snap.Cues);
    }
}
