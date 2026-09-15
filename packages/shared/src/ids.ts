import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const SESSION_ID_RE = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;
export const UTTERANCE_ID_RE = /^utt_[0-9A-HJKMNP-TV-Z]{26}$/;
export const ARTIFACT_ID_RE = /^art_[0-9A-HJKMNP-TV-Z]{26}$/;
export const ROUTINE_ID_RE = /^rtn_[0-9A-HJKMNP-TV-Z]{26}$/;
export const AGENT_ID_RE = /^[a-z0-9_-]{2,32}$/;
export const IDEMPOTENCY_KEY_RE = /^[\x21-\x7E]{8,128}$/;

function encodeCrockford(value: bigint, length: number): string {
  const chars: string[] = [];
  let remaining = value;
  for (let i = 0; i < length; i++) {
    chars.push(CROCKFORD[Number(remaining & 31n)] ?? "0");
    remaining >>= 5n;
  }
  return chars.reverse().join("");
}

/** Crockford ULID: 48-bit time + 80-bit entropy, 26 characters. */
export function ulid(nowMs = Date.now()): string {
  const time = encodeCrockford(BigInt(nowMs), 10);
  const bytes = randomBytes(10);
  let entropy = 0n;
  for (const b of bytes) {
    entropy = (entropy << 8n) | BigInt(b);
  }
  return time + encodeCrockford(entropy, 16);
}

export function newSessionId(nowMs?: number): string {
  return `ses_${ulid(nowMs)}`;
}

export function newUtteranceId(nowMs?: number): string {
  return `utt_${ulid(nowMs)}`;
}

export function newArtifactId(nowMs?: number): string {
  return `art_${ulid(nowMs)}`;
}

export function newRoutineId(nowMs?: number): string {
  return `rtn_${ulid(nowMs)}`;
}

export function isRoutineId(value: string): boolean {
  return ROUTINE_ID_RE.test(value);
}

export function newEventId(nowMs?: number): string {
  return `evt_${ulid(nowMs)}`;
}

export function isSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

export function isUtteranceId(value: string): boolean {
  return UTTERANCE_ID_RE.test(value);
}

export function isArtifactId(value: string): boolean {
  return ARTIFACT_ID_RE.test(value);
}

export function isAgentId(value: string): boolean {
  return AGENT_ID_RE.test(value);
}
