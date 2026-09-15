import {
  isAssistantSpeaker,
  redactSecrets,
  spotAddress,
  type TranscriptSegment,
} from "@teams-audio-join/shared";
import { matchEcho, type PlayedUtterance } from "./echo.ts";

export interface RawCaption {
  tMs: number;
  endMs: number;
  speaker: string;
  text: string;
  isPartial?: boolean;
}

export function classifyCaptions(
  rows: RawCaption[],
  seqStart: number,
  assistantDisplayName: string,
  wakePhrases: string[] = [],
  played: PlayedUtterance[] = [],
): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let seq = seqStart;
  for (const row of rows) {
    const { text, redacted } = redactSecrets(row.text);
    const echo = matchEcho(text, played);
    const assistant = Boolean(echo) || isAssistantSpeaker(row.speaker, assistantDisplayName);
    const spot = assistant ? { addressed: false as const } : spotAddress(text, assistantDisplayName, wakePhrases);
    seq += 1;
    const seg: TranscriptSegment = {
      seq,
      tMs: row.tMs,
      endMs: Math.max(row.tMs, row.endMs),
      speaker: assistant ? assistantDisplayName : row.speaker.slice(0, 128) || "Speaker 1",
      speakerKind: assistant ? "assistant" : "human",
      text,
      isPartial: row.isPartial ?? false,
      source: assistant ? "agent_tts_echo" : "teams_official",
    };
    if (echo) seg.linkedUtteranceId = echo.utteranceId;
    if (spot.addressed) seg.addressedToAssistant = true;
    if (redacted) seg.redacted = true;
    out.push(seg);
  }
  return out;
}
