const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function isBcp47(value: string): boolean {
  return LOCALE_RE.test(value);
}
