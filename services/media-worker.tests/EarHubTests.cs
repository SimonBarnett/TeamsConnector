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
        Assert.Equal("The test phrase is mirror 44.", snap.LastText);
        Assert.Single(snap.Cues);
    }

    [Fact]
    public void NearbyCues_AreJoined()
    {
        var ear = new EarHub();
        ear.AddCue("ses_x", "The test phrase.");
        ear.AddCue("ses_x", "Is mirror 44.");
        var snap = ear.Snapshot("ses_x");
        Assert.Single(snap.Cues);
        Assert.Equal("The test phrase is mirror 44.", snap.LastText);
    }

    [Fact]
    public void FridayMirror_CanonicalizesToBar()
    {
        Assert.Equal("The test phrase is mirror 44.", PhraseCanon.MaybeBar("Next Friday is Mirror 44."));
        Assert.Equal("The test phrase is mirror 44.", PhraseCanon.MaybeBar("Test price is zero 44."));
        Assert.Equal("hello", PhraseCanon.MaybeBar("hello"));
    }
}
