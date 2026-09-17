using System.Globalization;
using System.Text.RegularExpressions;

namespace TeamsAudioJoin.MediaWorker;

public sealed record VttCue(string Text, string Speaker, int TMs, int EndMs);

public static class VttCueParser
{
    public static IReadOnlyList<VttCue> Parse(string vtt)
    {
        var blocks = vtt.Replace("\uFEFF", "").Replace("\r\n", "\n").Split("\n\n", StringSplitOptions.RemoveEmptyEntries);
        var outList = new List<VttCue>();
        foreach (var block in blocks)
        {
            var lines = block.Split('\n')
                .Select(l => l.TrimEnd())
                .Where(l => l.Length > 0 && l != "WEBVTT" && !l.StartsWith("NOTE", StringComparison.OrdinalIgnoreCase))
                .ToArray();
            var timeLine = lines.FirstOrDefault(l => l.Contains("-->", StringComparison.Ordinal));
            if (timeLine is null) continue;
            var parts = timeLine.Split("-->", 2, StringSplitOptions.TrimEntries);
            var tMs = ParseTs(parts[0]);
            var endMs = Math.Max(tMs, ParseTs(parts.Length > 1 ? parts[1].Split(' ')[0] : parts[0]));
            var textLines = lines.Where(l => l != timeLine && !Regex.IsMatch(l, @"^\d+$")).ToArray();
            var text = string.Join(" ", textLines).Trim();
            var speaker = "Speaker 1";
            var voice = Regex.Match(text, @"^<v\s+([^>]+)>(.*)$", RegexOptions.IgnoreCase | RegexOptions.Singleline);
            if (voice.Success)
            {
                speaker = voice.Groups[1].Value.Trim();
                text = Regex.Replace(voice.Groups[2].Value, @"</v>\s*$", "", RegexOptions.IgnoreCase).Trim();
            }
            if (string.IsNullOrWhiteSpace(text)) continue;
            outList.Add(new VttCue(text, speaker, tMs, endMs));
        }
        return outList;
    }

    private static int ParseTs(string raw)
    {
        var m = Regex.Match(raw.Trim(), @"(?:(\d+):)?(\d{2}):(\d{2})[.](\d+)");
        if (!m.Success) return 0;
        var h = m.Groups[1].Success && m.Groups[1].Length > 0 ? int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
        var min = int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture);
        var s = int.Parse(m.Groups[3].Value, CultureInfo.InvariantCulture);
        var ms = int.Parse(m.Groups[4].Value.PadRight(3, '0')[..3], CultureInfo.InvariantCulture);
        return ((h * 60 + min) * 60 + s) * 1000 + ms;
    }
}
