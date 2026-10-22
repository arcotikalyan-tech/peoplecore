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

/**
 * CSV for text that stays inside the app (an uploaded sheet carried between import steps): quoted where needed, but
 * without the formula prefix, so values such as +91 phone numbers come back unchanged.
 */
export function toPlainCsv(rows: ReadonlyArray<readonly string[]>): string {
  return rows.map((row) => row.map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(',')).join('\r\n') + '\r\n';
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly CsvValue[]>): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * Parses RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF, optional BOM). Returns rows of cells;
 * blank lines are dropped. Throws on an unterminated quote.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error('The file has an unclosed quote.');
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}
