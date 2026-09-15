using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class TtsPcmPlayerTests
{
    [Fact]
    public void CancelStopsWithinOneFrame()
    {
        var player = new TtsPcmPlayer();
        var pcm = new byte[TtsPcmPlayer.SampleRate * TtsPcmPlayer.BytesPerSample]; // 1s
        player.Start("utt_1", pcm);
        var frame = new byte[TtsPcmPlayer.FrameBytes];
        Assert.True(player.TryReadFrame(frame));
        var id = player.Cancel();
        Assert.Equal("utt_1", id);
        Assert.False(player.Playing);
        Assert.True(player.StopLatency < TimeSpan.FromMilliseconds(400));
        Assert.False(player.TryReadFrame(frame));
    }

    [Fact]
    public void LeaveDisposesWithoutWritingFiles()
    {
        using var player = new TtsPcmPlayer();
        player.Start("utt_2", new byte[TtsPcmPlayer.FrameBytes * 3]);
        player.Dispose();
        Assert.False(player.Playing);
    }
}
