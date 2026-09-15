import {
  newArtifactId,
  nowIso,
  type Artifact,
  type SessionRecord,
  type SummaryStyle,
  type TranscriptSegment,
} from "@teams-audio-join/shared";

export interface LlmClient {
  complete(prompt: string): Promise<string>;
}

export const GROUNDED_SYSTEM = `You summarise a Microsoft Teams meeting from transcript segments.
Rules:
- Use ONLY speakerKind=human finals. Ignore assistant / agent_tts_echo rows unless the user asked what the assistant said.
- Never invent quotes that are not present in the provided segments.
- Never treat Speaker N as a billing identity.
- If there are no usable segments, say that no transcript was available. Do not fabricate a meeting narrative from the title.
- Return JSON only: { "summary": string, "decisions": string[], "actions": [{"text": string, "owner"?: string, "due"?: string, "confidence": number}], "openQuestions": string[] }
- Max 50 decisions, actions, and open questions. Summary 1-8000 chars.`;

export function humanFinals(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.filter((s) => !s.isPartial && s.speakerKind === "human" && s.source !== "owner_command");
}

export function buildPrompt(style: SummaryStyle, meetingSubject: string | undefined, segments: TranscriptSegment[]): string {
  const usable = humanFinals(segments);
  const lines = usable.map((s) => `[seq=${s.seq} t=${s.tMs} speaker=${s.speaker}] ${s.text}`).join("\n");
  return `${GROUNDED_SYSTEM}

Style: ${style}
Meeting subject (do not use as evidence): ${meetingSubject ?? "(unknown)"}

Segments:
${lines || "(none)"}
`;
}

interface ModelJson {
  summary?: string;
  decisions?: unknown[];
  actions?: unknown[];
  openQuestions?: unknown[];
}

function clip(s: string, max: number): string {
  return s.slice(0, max);
}

function asStringArray(value: unknown, itemMax: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => clip(x.trim(), itemMax))
    .slice(0, 50);
}

export function parseModelJson(raw: string): Pick<Artifact, "summary" | "decisions" | "actions" | "openQuestions"> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const json = start >= 0 && end >= start ? raw.slice(start, end + 1) : "{}";
  let parsed: ModelJson = {};
  try {
    parsed = JSON.parse(json) as ModelJson;
  } catch {
    parsed = {};
  }
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions
        .map((a) => {
          if (!a || typeof a !== "object") return undefined;
          const rec = a as Record<string, unknown>;
          const text = typeof rec.text === "string" ? clip(rec.text.trim(), 500) : "";
          if (!text) return undefined;
          const item: Artifact["actions"][number] = {
            text,
            confidence: typeof rec.confidence === "number" ? Math.min(1, Math.max(0, rec.confidence)) : 0.5,
          };
          if (typeof rec.owner === "string") item.owner = clip(rec.owner, 128);
          if (typeof rec.due === "string") item.due = rec.due;
          return item;
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
        .slice(0, 50)
    : [];
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? clip(parsed.summary.trim(), 8000)
      : "No transcript was available to summarise.";
  return {
    summary,
    decisions: asStringArray(parsed.decisions, 400),
    actions,
    openQuestions: asStringArray(parsed.openQuestions, 400),
  };
}

export function hoursHintFor(session: SessionRecord): Artifact["hoursHint"] | undefined {
  const start = Date.parse(session.admittedAt ?? session.startedAt ?? session.createdAt);
  const end = Date.parse(session.endedAt ?? nowIso());
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  const hoursRaw = (end - start) / 3_600_000;
  const hours = Math.min(12, Math.max(0.25, Math.round(hoursRaw * 4) / 4));
  return {
    hours,
    label: session.meeting.subject ?? "Teams meeting",
    billableSuggested: false,
  };
}

export async function summarise(input: {
  session: SessionRecord;
  segments: TranscriptSegment[];
  style: SummaryStyle;
  llm: LlmClient;
  now?: string;
}): Promise<Artifact> {
  const usable = humanFinals(input.segments);
  const seqs = usable.map((s) => s.seq);
  const from = seqs.length ? Math.min(...seqs) : 0;
  const to = seqs.length ? Math.max(...seqs) : 0;
  if (usable.length === 0) {
    const empty: Artifact = {
      artifactId: newArtifactId(),
      sessionId: input.session.sessionId,
      style: input.style,
      partial: input.session.state !== "ended" && input.session.state !== "failed",
      createdAt: input.now ?? nowIso(),
      summary: "No audio or official transcript was available. The assistant did not hear this meeting.",
      decisions: [],
      actions: [],
      openQuestions: [],
      groundedSeqRange: { from, to },
    };
    if (input.style === "hours") empty.hoursHint = hoursHintFor(input.session);
    return empty;
  }

  const raw = await input.llm.complete(buildPrompt(input.style, input.session.meeting.subject, input.segments));
  const parsed = parseModelJson(raw);
  const artifact: Artifact = {
    artifactId: newArtifactId(),
    sessionId: input.session.sessionId,
    style: input.style,
    partial: input.session.state !== "ended" && input.session.state !== "failed",
    createdAt: input.now ?? nowIso(),
    summary: parsed.summary,
    decisions: parsed.decisions,
    actions: parsed.actions,
    openQuestions: parsed.openQuestions,
    groundedSeqRange: { from, to },
  };
  if (input.style === "hours") artifact.hoursHint = hoursHintFor(input.session);
  return artifact;
}

export class XaiLlmClient implements LlmClient {
  constructor(
    private readonly opts: {
      apiKey: string;
      baseUrl?: string;
      model?: string;
    },
  ) {}

  async complete(prompt: string): Promise<string> {
    const base = this.opts.baseUrl ?? "https://api.x.ai/v1";
    const model = this.opts.model ?? "grok-4.5";
    const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: GROUNDED_SYSTEM },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`xAI summary failed: ${res.status}`);
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return body.choices?.[0]?.message?.content ?? "";
  }
}

export class FixtureLlmClient implements LlmClient {
  constructor(private readonly payload: ModelJson) {}
  async complete(): Promise<string> {
    return JSON.stringify(this.payload);
  }
}
