export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  page: number;
  pageSize: number;
  /** Inclusive row range for PostgREST `.range(from, to)`. */
  from: number;
  to: number;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

/** Normalizes untrusted page/pageSize query params; page size is capped to protect the database. */
export function parsePageRequest(params: { page?: unknown; pageSize?: unknown }): PageRequest {
  const page = Math.min(toPositiveInt(params.page, 1), 10_000);
  const pageSize = Math.min(toPositiveInt(params.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Escapes `%`, `_` and `\` so user search text is matched literally inside ILIKE patterns. */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
