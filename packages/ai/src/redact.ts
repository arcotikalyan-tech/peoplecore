/**
 * Masks identifiers in text before it leaves for a model provider. Each agent lists what to mask in the text the
 * user typed; the data an agent loads is chosen field by field instead (only what the task needs). Files (a resume,
 * a receipt) can't be masked: the agents that read them never return protected attributes (see their schemas).
 */

export type RedactionKind = 'email' | 'phone' | 'pan' | 'aadhaar' | 'ifsc' | 'bank_account';

export const ALL_IDENTIFIERS: RedactionKind[] = ['email', 'pan', 'ifsc', 'aadhaar', 'phone', 'bank_account'];

// Order matters: the specific number formats go before the generic digit runs.
const PATTERNS: Record<RedactionKind, RegExp> = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  pan: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
  ifsc: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
  aadhaar: /\b[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}\b/g,
  phone: /(?:\+91[ -]?|\b0)?\b[6-9][0-9]{4}[ -]?[0-9]{5}\b/g,
  bank_account: /\b[0-9]{9,18}\b/g,
};

export type RedactionSummary = Partial<Record<RedactionKind, number>>;

export function redactText(text: string, kinds: readonly RedactionKind[], summary: RedactionSummary = {}): string {
  let out = text;
  for (const kind of ALL_IDENTIFIERS) {
    if (!kinds.includes(kind)) continue;
    out = out.replace(PATTERNS[kind], () => {
      summary[kind] = (summary[kind] ?? 0) + 1;
      return `[${kind}]`;
    });
  }
  return out;
}

/** Masks every string inside a value (objects and arrays included). */
export function redactValue<T>(value: T, kinds: readonly RedactionKind[], summary: RedactionSummary = {}): T {
  if (kinds.length === 0) return value;
  if (typeof value === 'string') return redactText(value, kinds, summary) as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, kinds, summary)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, kinds, summary)])) as T;
  }
  return value;
}
