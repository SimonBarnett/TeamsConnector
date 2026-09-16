import type { TranscriptSegment } from "@teams-audio-join/shared";

function parseTimestamp(raw: string): number {
  const m = raw.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[.](\d+)/);
  if (!m) return 0;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const s = Number(m[3]);
  const ms = Number((m[4] ?? "0").padEnd(3, "0").slice(0, 3));
  return ((h * 60 + min) * 60 + s) * 1000 + ms;
}

export function parseWebVtt(vtt: string, seqStart = 1): Omit<TranscriptSegment, "seq" | "source" | "speakerKind">[] {
  const blocks = vtt.replace(/^\uFEFF/, "").split(/\r?\n\r?\n/);
  const out: Omit<TranscriptSegment, "seq" | "source" | "speakerKind">[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.length > 0 && l !== "WEBVTT" && !l.startsWith("NOTE"));
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const [startRaw, endRaw] = timeLine.split("-->");
    const tMs = parseTimestamp(startRaw ?? "0");
    const endToken = (endRaw ?? "0").trim().split(/\s+/)[0] ?? "0";
    const endMs = Math.max(tMs, parseTimestamp(endToken));
    const textLines = lines.filter((l) => l !== timeLine && !/^\d+$/.test(l));
    let speaker = "Speaker 1";
    let text = textLines.join(" ").trim();
    const voice = text.match(/^<v\s+([^>]+)>(.*)$/i);
    if (voice) {
      speaker = (voice[1] ?? speaker).trim();
      text = (voice[2] ?? "").replace(/<\/v>\s*$/i, "").trim();
    } else {
      const labeled = text.match(/^([^:]{1,64}):\s*(.*)$/);
      if (labeled) {
        speaker = labeled[1] ?? speaker;
        text = labeled[2] ?? "";
      }
    }
    if (!text) continue;
    out.push({ tMs, endMs, speaker, text, isPartial: false });
  }
  return out.map((row, i) => ({ ...row, seq: seqStart + i })) as never;
}

export interface GraphJsonEntry {
  id?: string;
  text?: string;
  speakerDisplayName?: string;
  startOffset?: string;
  endOffset?: string;
}

export function parseGraphJson(
  payload: { entries?: GraphJsonEntry[] } | GraphJsonEntry[],
  seqStart = 1,
): { tMs: number; endMs: number; speaker: string; text: string; isPartial: false }[] {
  const entries = Array.isArray(payload) ? payload : (payload.entries ?? []);
  const rows = [];
  for (const e of entries) {
    const text = (e.text ?? "").trim();
    if (!text) continue;
    const tMs = parseTimestamp(e.startOffset ?? "00:00:00.000");
    const endMs = Math.max(tMs, parseTimestamp(e.endOffset ?? e.startOffset ?? "00:00:00.000"));
    rows.push({
      tMs,
      endMs,
      speaker: e.speakerDisplayName?.trim() || "Speaker 1",
      text,
      isPartial: false as const,
    });
  }
  return rows.map((row, i) => ({ ...row, seq: seqStart + i })) as never;
}

export function parseTranscriptContent(content: string, seqStart = 1) {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return parseGraphJson(JSON.parse(trimmed), seqStart);
    } catch {
      /* fall through to VTT */
    }
  }
  return parseWebVtt(content, seqStart);
}
