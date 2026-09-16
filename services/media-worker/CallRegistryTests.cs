using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class CallRegistryTests
{
    [Fact]
    public void RefusesPlayUntilEstablishedAndCancelRequiresActivePrompt()
    {
        var r = new CallRegistry();
        r.Track("ses_1", "call_1");
        Assert.False(r.CanPlay("ses_1"));
        r.SetState("ses_1", CallLifecycle.Established);
        Assert.True(r.CanPlay("ses_1"));
        Assert.False(r.TryTakeActivePrompt("ses_1", null, out _));
        r.SetActivePrompt("ses_1", "utt_9");
        Assert.True(r.TryTakeActivePrompt("ses_1", null, out var id));
        Assert.Equal("utt_9", id);
        Assert.False(r.TryTakeActivePrompt("ses_1", null, out _));
    }
}
