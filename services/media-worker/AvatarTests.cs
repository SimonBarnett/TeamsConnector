using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class AvatarTests
{
    [Fact]
    public void Nv12BufferIsOneAndAHalfTimesPixels()
    {
        const int w = 640;
        const int h = 360;
        var rgb = new byte[w * h * 3];
        for (var i = 0; i < rgb.Length; i += 3)
        {
            rgb[i] = 91;
            rgb[i + 1] = 44;
            rgb[i + 2] = 111;
        }

        var nv12 = Nv12Converter.FromRgb24(rgb, w, h);
        Assert.Equal(w * h * 3 / 2, nv12.Length);
        Assert.NotEqual(0, nv12[0]);
    }

    [Fact]
    public void ListenWithAvatarIsSendOnlyVideoAndHasNoVbss()
    {
        var sockets = MediaSessionPlan.ForListenWithAvatar();
        MediaSessionPlan.EnsureNoInboundVideo(sockets);
        Assert.Contains(sockets, s => s.Kind == "video" && s.Direction == MediaDirection.Sendonly);
        Assert.DoesNotContain(sockets, s => s.Kind == "video" && s.Direction != MediaDirection.Sendonly);
        Assert.DoesNotContain(sockets, s => s.Vbss);
        Assert.Equal(MediaSessionPlan.AvatarWidth, sockets.Single(s => s.Kind == "video").Width);
    }

    [Fact]
    public void StillLoopSendsInMemoryAndWritesNoFiles()
    {
        var nv12 = new byte[MediaSessionPlan.AvatarWidth * MediaSessionPlan.AvatarHeight * 3 / 2];
        var sent = 0;
        using var loop = new StillAvatarLoop(nv12, _ => Interlocked.Increment(ref sent), fps: 50);
        loop.Start();
        Thread.Sleep(80);
        loop.Stop();
        Assert.True(loop.FramesSent >= 1);
        Assert.True(sent >= 1);
        Assert.False(loop.Sending);
    }

    [Fact]
    public void EnsureNoInboundVideoRejectsRecv()
    {
        var bad = new[] { new MediaSocketPlan("video", MediaDirection.Recvonly) };
        Assert.Throws<InvalidOperationException>(() => MediaSessionPlan.EnsureNoInboundVideo(bad));
    }
}
