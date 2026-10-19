/**
 * Letter merge tags and rendering. Pure functions, used by the server (generating letters) and the template editor
 * (live preview). Tags look like `{{ full name }}`; a tag with no value renders as `[full name]` so a missing value
 * is visible in the preview instead of silently blank.
 */

export type TagGroup = 'Employee' | 'Salary' | 'Dates' | 'Address' | 'Company';
export interface MergeTag { tag: string; label: string; group: TagGroup }

const t = (group: TagGroup, tag: string, label: string): MergeTag => ({ tag, label, group });
const salary = (prefix: string, who: string) => [
  ['annual ctc', 'Annual CTC'], ['monthly ctc', 'Monthly CTC'], ['annual basic', 'Annual basic'], ['monthly basic', 'Monthly basic'],
  ['annual hra', 'Annual HRA'], ['monthly hra', 'Monthly HRA'], ['annual spa', 'Annual special allowance'], ['monthly spa', 'Monthly special allowance'],
  ['annual fixed', 'Annual fixed pay'], ['monthly fixed', 'Monthly fixed pay'], ['annual pf', 'Annual employer PF'], ['monthly pf', 'Monthly employer PF'],
].map(([k, l]) => t('Salary', `${prefix}${k}`, `${l}${who}`));

export const MERGE_TAGS: MergeTag[] = [
  t('Dates', 'date', 'Date of letter generation'),
  t('Employee', 'salutation', 'Ms/Mr/Mx'),
  t('Employee', 'full name', 'Full name'),
  t('Employee', 'first name', 'First name only'),
  t('Employee', 'employee id', 'Employee ID'),
  t('Employee', 'designation', 'Designation'),
  t('Employee', 'department', 'Department'),
  t('Employee', 'location', 'Work location'),
  t('Employee', 'gender template', 'his/her/their'),
  t('Employee', 'gender template 2', 'he/she/they'),
  t('Employee', 'gender template 3', 'him/her/them'),
  t('Address', 'address', 'Address'),
  t('Address', 'address line 1', 'Address line 1'),
  t('Address', 'address line 2', 'Address line 2'),
  t('Address', 'city', 'City'),
  t('Address', 'state', 'State'),
  t('Address', 'pincode', 'Pincode'),
  t('Address', 'current address', 'Current full address'),
  t('Address', 'posting city', 'Posting city'),
  t('Address', 'posting state', 'Posting state'),
  t('Address', 'posting location', 'Posting location'),
  t('Dates', 'date of joining', 'Date of joining'),
  t('Dates', 'confirmation date', 'Confirmation date'),
  t('Dates', 'termination date', 'Last working day'),
  t('Dates', 'probation period in months', 'Probation period (months)'),
  t('Dates', 'probation notice period', 'Notice period on probation'),
  t('Dates', 'confirmation notice period', 'Notice period after confirmation'),
  t('Dates', 'promotion date', 'Promotion date'),
  t('Dates', 'salary revision date', 'Salary revision date'),
  t('Dates', 'extension start date', 'Probation extension start'),
  t('Dates', 'extension end date', 'Probation extension end'),
  t('Dates', 'extendible probation period in months', 'Probation extension (months)'),
  t('Dates', 'internship start date', 'Internship start'),
  t('Dates', 'internship end date', 'Internship end'),
  t('Dates', 'internship notice period', 'Internship notice period'),
  t('Dates', 'leave start date', 'Leave start'),
  t('Dates', 'leave end date', 'Leave end'),
  t('Dates', 'no of months', 'Number of months'),
  t('Employee', 'new designation', 'New designation'),
  t('Employee', 'reason', 'Reason'),
  t('Salary', 'stipend amount', 'Monthly stipend'),
  ...salary('', ''),
  ...salary('revised ', ' (revised)'),
  t('Employee', 'new joinee salutation', 'New joinee: Ms/Mr/Mx'),
  t('Employee', 'new joinee full name', 'New joinee: full name'),
  t('Employee', 'new joinee first name', 'New joinee: first name'),
  t('Employee', 'new joinee designation', 'New joinee: designation'),
  t('Address', 'new joinee address', 'New joinee: address'),
  t('Dates', 'new joinee date of joining', 'New joinee: date of joining'),
  t('Dates', 'new joinee probation notice period', 'New joinee: notice on probation'),
  t('Dates', 'new joinee confirmation notice period', 'New joinee: notice after confirmation'),
  ...salary('new joinee ', ' (new joinee)'),
  t('Company', 'company name', 'Company name'),
  t('Company', 'new joinee company name', 'Company name (offer)'),
  t('Company', 'authorized signatory name', 'Signatory name'),
  t('Company', 'authorized signatory designation', 'Signatory designation'),
  t('Company', 'authorized signatory address', 'Signatory address'),
  t('Company', 'authorized signatory signature', 'Signature image'),
];

export const KNOWN_TAGS = new Set(MERGE_TAGS.map((m) => m.tag));
/** Rendered by the letter page itself (an image), never replaced with text. */
export const SIGNATURE_TAG = 'authorized signatory signature';

const TAG = /\{\{\s*([a-z0-9 ]+?)\s*\}\}/gi;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function tagsIn(body: string): string[] {
  return [...new Set([...body.matchAll(TAG)].map((m) => norm(m[1]!)))];
}

export function unknownTags(body: string): string[] {
  return tagsIn(body).filter((tag) => !KNOWN_TAGS.has(tag));
}

/** Replace every tag with its value; the signature tag is kept for the letter page; missing values show as [tag]. */
export function renderLetter(body: string, values: Record<string, string | null | undefined>): string {
  return body.replace(TAG, (whole, raw: string) => {
    const tag = norm(raw);
    if (tag === SIGNATURE_TAG) return `{{ ${SIGNATURE_TAG} }}`;
    const v = values[tag];
    return v === null || v === undefined || v === '' ? `[${tag}]` : v;
  });
}

/** Paragraphs (blank-line separated) of lines; a line equal to the signature tag is the signature slot. */
export function paragraphs(text: string): string[][] {
  return text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.split('\n'));
}

export const isSignatureLine = (line: string) => norm(line.replace(/[{}]/g, '')) === SIGNATURE_TAG;
