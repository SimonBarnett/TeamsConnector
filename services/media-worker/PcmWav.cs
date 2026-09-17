using System.Buffers.Binary;

namespace TeamsAudioJoin.MediaWorker;

public static class PcmWav
{
    public static byte[] Wrap16kMono(ReadOnlySpan<byte> pcm16)
    {
        var wav = new byte[44 + pcm16.Length];
        wav[0] = (byte)'R'; wav[1] = (byte)'I'; wav[2] = (byte)'F'; wav[3] = (byte)'F';
        BinaryPrimitives.WriteInt32LittleEndian(wav.AsSpan(4), 36 + pcm16.Length);
        wav[8] = (byte)'W'; wav[9] = (byte)'A'; wav[10] = (byte)'V'; wav[11] = (byte)'E';
        wav[12] = (byte)'f'; wav[13] = (byte)'m'; wav[14] = (byte)'t'; wav[15] = (byte)' ';
        BinaryPrimitives.WriteInt32LittleEndian(wav.AsSpan(16), 16);
        BinaryPrimitives.WriteInt16LittleEndian(wav.AsSpan(20), 1);
        BinaryPrimitives.WriteInt16LittleEndian(wav.AsSpan(22), 1);
        BinaryPrimitives.WriteInt32LittleEndian(wav.AsSpan(24), 16_000);
        BinaryPrimitives.WriteInt32LittleEndian(wav.AsSpan(28), 16_000 * 2);
        BinaryPrimitives.WriteInt16LittleEndian(wav.AsSpan(32), 2);
        BinaryPrimitives.WriteInt16LittleEndian(wav.AsSpan(34), 16);
        wav[36] = (byte)'d'; wav[37] = (byte)'a'; wav[38] = (byte)'t'; wav[39] = (byte)'a';
        BinaryPrimitives.WriteInt32LittleEndian(wav.AsSpan(40), pcm16.Length);
        pcm16.CopyTo(wav.AsSpan(44));
        return wav;
    }

    public static bool HasEnergy(ReadOnlySpan<byte> pcm16, int minRms = 200)
    {
        if (pcm16.Length < 4) return false;
        long sum = 0;
        var n = pcm16.Length / 2;
        for (var i = 0; i + 1 < pcm16.Length; i += 2)
        {
            var s = (short)(pcm16[i] | (pcm16[i + 1] << 8));
            sum += s * s;
        }
        var rms = Math.Sqrt(sum / (double)n);
        return rms >= minRms;
    }
}
