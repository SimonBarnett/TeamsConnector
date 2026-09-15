import { redactSecrets } from "./redaction.ts";

const SSML = /<\/?(speak|voice|prosody|break|emphasis|say-as)\b|<\?xml/i;
const JOIN_URL = /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\//i;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

export function speakBlockedReason(text: string): string | undefined {
  if (SSML.test(text)) return "SSML is not accepted in v1.";
  if (CONTROL.test(text)) return "Control characters are not allowed.";
  if (JOIN_URL.test(text)) return "Join URLs must not be spoken.";
  if (SSN.test(text)) return "National identifiers must not be spoken.";
  const secrets = redactSecrets(text);
  if (secrets.redacted) return "Secrets, credentials, or payment data must not be spoken.";
  return undefined;
}
