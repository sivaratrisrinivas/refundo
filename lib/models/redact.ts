/**
 * Secret-like strings are redacted from diffs and claims before any model
 * call, so a secret in a Session can never reach a model (real or simulated).
 */
export const REDACTED = "[REDACTED]";

const KEY_PREFIXES =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;

const ENV_LINE = /^[ \t]*(?:export[ \t]+)?[A-Z][A-Z0-9_]{2,}[ \t]*=[ \t]*\S{6,}.*$/gm;

const LONG_BASE64 = /[A-Za-z0-9+/]{40,}={0,2}/g;

function looksLikeBase64Secret(token: string): boolean {
  if (!/[A-Z]/.test(token) || !/[a-z]/.test(token) || !/[0-9]/.test(token)) return false;
  // File paths and identifiers use many slashes; a secret rarely does.
  return (token.match(/\//g)?.length ?? 0) <= 2;
}

export function redactSecrets(text: string): string {
  return text
    .replace(ENV_LINE, REDACTED)
    .replace(KEY_PREFIXES, REDACTED)
    .replace(LONG_BASE64, (m) => (looksLikeBase64Secret(m) ? REDACTED : m));
}

/** Redact every string inside a JSON-like value. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v)]),
    ) as T;
  }
  return value;
}
