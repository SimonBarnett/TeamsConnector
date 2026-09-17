using System.Runtime.InteropServices;
using Microsoft.Skype.Bots.Media;

namespace TeamsAudioJoin.MediaHost;

/// <summary>20 ms PCM16 frame owned until the media platform disposes it.</summary>
internal sealed class PcmSendBuffer : AudioMediaBuffer
{
    public PcmSendBuffer(ReadOnlySpan<byte> pcm, long timestamp)
    {
        var length = pcm.Length;
        var ptr = Marshal.AllocHGlobal(length);
        unsafe
        {
            pcm.CopyTo(new Span<byte>((void*)ptr, length));
        }
        Data = ptr;
        Length = length;
        Timestamp = timestamp;
        AudioFormat = AudioFormat.Pcm16K;
    }

    protected override void Dispose(bool disposing)
    {
        if (Data != IntPtr.Zero)
        {
            Marshal.FreeHGlobal(Data);
            Data = IntPtr.Zero;
        }
    }
}
