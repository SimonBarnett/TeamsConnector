import type { SpeakVoice } from "@teams-audio-join/shared";

export interface TtsEngine {
  synthesize(text: string, voice: SpeakVoice): Promise<{ durationMs: number }>;
}

export function estimateDurationMs(text: string, voice: SpeakVoice): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const wps = voice === "assistant_brief" ? 3.2 : voice === "assistant_low" ? 2.0 : 2.5;
  return Math.max(400, Math.round((words / wps) * 1000));
}

/** No network, no audio files. Duration only — PCM is produced on the media worker. */
export class EstimatedTts implements TtsEngine {
  async synthesize(text: string, voice: SpeakVoice): Promise<{ durationMs: number }> {
    return { durationMs: estimateDurationMs(text, voice) };
  }
}

export const ANNOUNCE_TEMPLATE =
  "This is {name}, an AI assistant. I am here to take notes. I will speak only when asked.";

export function announceText(displayName: string): string {
  const name = displayName.split("(")[0]?.trim() || "Haitch";
  return ANNOUNCE_TEMPLATE.replace("{name}", name);
}
