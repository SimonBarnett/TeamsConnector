import { describe, expect, it } from "vitest";
import { parseTranscriptContent } from "./vtt.ts";

describe("transcript parsers", () => {
  it("parses Teams WebVTT voice tags", () => {
    const rows = parseTranscriptContent(`WEBVTT

00:00:01.000 --> 00:00:04.000
<v Simon Barnett>Hello everyone
`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.speaker).toBe("Simon Barnett");
    expect(rows[0]?.text).toBe("Hello everyone");
    expect(rows[0]?.tMs).toBe(1000);
    expect(rows[0]?.endMs).toBe(4000);
  });

  it("parses Graph JSON entries", () => {
    const rows = parseTranscriptContent(
      JSON.stringify({
        entries: [
          {
            text: "Ship it",
            speakerDisplayName: "Alex",
            startOffset: "00:00:10.0000000",
            endOffset: "00:00:12.5000000",
          },
        ],
      }),
    );
    expect(rows[0]?.speaker).toBe("Alex");
    expect(rows[0]?.tMs).toBe(10000);
    expect(rows[0]?.endMs).toBe(12500);
  });
});
