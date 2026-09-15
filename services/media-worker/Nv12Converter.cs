namespace TeamsAudioJoin.MediaWorker;

/// <summary>
/// RGB24 → NV12 (BT.601). Width and height must be even.
/// Output length is width * height * 3 / 2. No disk I/O.
/// </summary>
public static class Nv12Converter
{
    public static byte[] FromRgb24(ReadOnlySpan<byte> rgb, int width, int height)
    {
        if (width <= 0 || height <= 0 || (width & 1) != 0 || (height & 1) != 0)
        {
            throw new ArgumentException("width and height must be positive even integers.");
        }

        var expected = width * height * 3;
        if (rgb.Length < expected)
        {
            throw new ArgumentException($"RGB buffer must be at least {expected} bytes.");
        }

        var ySize = width * height;
        var nv12 = new byte[ySize + ySize / 2];
        var uv = ySize;

        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var i = (y * width + x) * 3;
                int r = rgb[i];
                int g = rgb[i + 1];
                int b = rgb[i + 2];
                var Y = (byte)Math.Clamp((77 * r + 150 * g + 29 * b) >> 8, 0, 255);
                nv12[y * width + x] = Y;

                if ((y & 1) == 0 && (x & 1) == 0)
                {
                    var U = (byte)Math.Clamp(((-43 * r - 85 * g + 128 * b) >> 8) + 128, 0, 255);
                    var V = (byte)Math.Clamp(((128 * r - 107 * g - 21 * b) >> 8) + 128, 0, 255);
                    var uvIndex = uv + (y / 2) * width + x;
                    nv12[uvIndex] = U;
                    nv12[uvIndex + 1] = V;
                }
            }
        }

        return nv12;
    }
}
