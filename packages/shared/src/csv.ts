/**
 * CSV (RFC 4180) for exports opened in Excel or Google Sheets.
 * - Fields with commas, quotes or line breaks are quoted; quotes are doubled.
 * - Formula injection: a cell starting with = + - @ tab or carriage return is prefixed with ' so
 *   spreadsheets show it as text instead of running it (OWASP "CSV injection").
 * - Starts with a UTF-8 byte-order mark so Excel reads non-ASCII names correctly. Lines end with CRLF.
 */
export type CsvValue = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly CsvValue[]>): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
