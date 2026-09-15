const REPLACEMENT = "[redacted]";

const PATTERNS: RegExp[] = [
  /\bpwd=[^&\s]+/gi,
  /\bpassword[=:][^\s&]+/gi,
  /\bBearer\s+[A-Za-z0-9._\-]+/gi,
  /\bsk-[A-Za-z0-9]{10,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}/g,
  /\b(xai|api)[-_]?key[=:]\s*[A-Za-z0-9._\-]{8,}/gi,
  /\b(client_secret|client-secret)[=:]\s*[A-Za-z0-9._\-~]{8,}/gi,
  /\b(lobby\s*pin|meeting\s*pin)[=:]\s*\d{4,}/gi,
];

export interface RedactionResult {
  text: string;
  redacted: boolean;
}

export function redactSecrets(text: string): RedactionResult {
  let out = text;
  let redacted = false;
  for (const pattern of PATTERNS) {
    const next = out.replace(pattern, REPLACEMENT);
    if (next !== out) redacted = true;
    out = next;
  }
  out = redactCardNumbers(out, (changed) => {
    if (changed) redacted = true;
  });
  return { text: out.slice(0, 4000), redacted };
}

function redactCardNumbers(text: string, mark: (changed: boolean) => void): string {
  return text.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return match;
    if (!luhn(digits)) return match;
    mark(true);
    return REPLACEMENT;
  });
}

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function looksLikeAudioBlobName(name: string): boolean {
  return /\.(wav|pcm|opus|ogg|mp3|m4a|webm)$/i.test(name);
}
