export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Token F1 between two strings. Spec: ≥ 0.7 means TTS echo. */
export function tokenF1(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const precision = inter / ta.size;
  const recall = inter / tb.size;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

export interface PlayedUtterance {
  utteranceId: string;
  text: string;
}

export function matchEcho(text: string, played: PlayedUtterance[], threshold = 0.7): PlayedUtterance | undefined {
  let best: { u: PlayedUtterance; score: number } | undefined;
  for (const u of played) {
    const score = tokenF1(text, u.text);
    if (!best || score > best.score) best = { u, score };
  }
  return best && best.score >= threshold ? best.u : undefined;
}
