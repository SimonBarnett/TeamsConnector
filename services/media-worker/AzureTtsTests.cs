using Xunit;

namespace TeamsAudioJoin.MediaWorker;

public class AzureTtsTests
{
    [Fact]
    public void DetectsSilentBuffers()
    {
        Assert.True(AzureTts.IsSilentPcm(new byte[100]));
        var wav = new byte[48];
        wav[0] = (byte)'R';
        wav[44] = 1;
        Assert.False(AzureTts.IsSilentPcm(wav));
    }
}
