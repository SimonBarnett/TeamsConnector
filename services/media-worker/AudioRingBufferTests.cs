using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class AudioRingBufferTests
{
    [Fact]
    public void DoesNotGrowPastTenSeconds()
    {
        var buf = new AudioRingBuffer();
        var frame = new byte[AudioRingBuffer.SampleRate * AudioRingBuffer.BytesPerSample * AudioRingBuffer.FrameMs / 1000];
        for (var i = 0; i < 1000; i++) buf.PushFrame(frame);
        Assert.Equal(buf.CapacityBytes, buf.FilledBytes);
        Assert.True(buf.CapacityBytes <= AudioRingBuffer.SampleRate * AudioRingBuffer.BytesPerSample * AudioRingBuffer.MaxSeconds);
    }

    [Fact]
    public void UnconfiguredWorkerIsUnhealthyAndRefusesJoin()
    {
        var worker = new UnconfiguredMediaWorker();
        Assert.False(worker.HealthAsync().Result.Healthy);
        var ex = Record.Exception(() => worker.JoinAsync(new JoinCommand("ses_x", "https://teams.microsoft.com/l/meetup-join/x", "en-GB")).GetAwaiter().GetResult());
        Assert.IsType<InvalidOperationException>(ex);
    }
}
