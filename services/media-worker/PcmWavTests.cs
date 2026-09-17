using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class PcmWavTests
{
    [Fact]
    public void WrapsPcmWithRiffHeader()
    {
        var pcm = new byte[] { 1, 0, 2, 0 };
        var wav = PcmWav.Wrap16kMono(pcm);
        Assert.Equal(48, wav.Length);
        Assert.Equal((byte)'R', wav[0]);
        Assert.Equal(4, BitConverter.ToInt32(wav, 40));
    }

    [Fact]
    public void DetectsSilenceVsEnergy()
    {
        Assert.False(PcmWav.HasEnergy(new byte[40]));
        var loud = new byte[40];
        for (var i = 0; i < loud.Length; i += 2) { loud[i] = 0x00; loud[i + 1] = 0x40; }
        Assert.True(PcmWav.HasEnergy(loud));
    }
}
