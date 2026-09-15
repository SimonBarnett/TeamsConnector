export type AddressTrigger = "name" | "owner_ping" | "wake_phrase";

export interface NameSpotResult {
  addressed: boolean;
  trigger?: AddressTrigger;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstToken(displayName: string): string {
  const trimmed = displayName.trim();
  const cut = trimmed.split(/[\s(]/)[0] ?? trimmed;
  return cut.replace(/[^A-Za-z0-9_-]/g, "");
}

export function spotAddress(
  text: string,
  assistantDisplayName: string,
  wakePhrases: string[] = [],
): NameSpotResult {
  const needles: { phrase: string; trigger: AddressTrigger }[] = [];
  const full = assistantDisplayName.trim();
  if (full) needles.push({ phrase: full, trigger: "name" });
  const token = firstToken(full);
  if (token && token.length >= 3 && token.toLowerCase() !== full.toLowerCase()) {
    needles.push({ phrase: token, trigger: "name" });
  }
  needles.push({ phrase: "assistant", trigger: "name" });
  for (const phrase of wakePhrases) {
    if (phrase.trim()) needles.push({ phrase: phrase.trim(), trigger: "wake_phrase" });
  }

  for (const { phrase, trigger } of needles) {
    const re = new RegExp(`\\b${escapeRe(phrase)}\\b`, "i");
    if (re.test(text)) return { addressed: true, trigger };
  }
  return { addressed: false };
}

export function isAssistantSpeaker(speaker: string, assistantDisplayName: string): boolean {
  const a = speaker.trim().toLowerCase();
  const b = assistantDisplayName.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const token = firstToken(assistantDisplayName).toLowerCase();
  return Boolean(token) && a === token;
}
