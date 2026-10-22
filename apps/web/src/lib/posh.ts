import { addDays, addMonths } from '@peoplecore/shared';

/**
 * POSH timelines under the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013
 * and its Rules: when each step of a complaint falls due. Working days skip Saturdays and Sundays (public holidays
 * aren't taken out). Dates are YYYY-MM-DD.
 */
export interface PoshSteps {
  filing_extended_on: string | null; conciliation_requested_on: string | null; conciliation_settled_on: string | null;
  notice_sent_on: string | null; reply_received_on: string | null; inquiry_completed_on: string | null;
  report_sent_on: string | null; action_taken_on: string | null; action_kind: string | null;
}

export type PoshStep = 'filing_extended' | 'conciliation_requested' | 'conciliation_settled' | 'notice_sent' | 'reply_received' | 'inquiry_completed' | 'report_sent' | 'action_taken';
export type StepState = 'done' | 'late' | 'overdue' | 'due_soon' | 'open' | 'optional' | 'not_needed';

export interface TimelineRow { key: string; step: PoshStep | null; label: string; rule: string; due: string | null; done: string | null; state: StepState }

/** The penalties rule 9 lists, and the outcomes besides them. */
export const POSH_ACTIONS: Record<string, string> = {
  written_apology: 'Written apology', warning: 'Warning', reprimand: 'Reprimand or censure', withholding_promotion: 'Promotion withheld',
  withholding_increment: 'Pay rise or increment withheld', termination: 'Termination', counselling: 'Counselling', community_service: 'Community service',
  no_action: 'No action (not proved)', other: 'Other action',
};

export const COMMITTEE_ROLES: Record<string, string> = { presiding_officer: 'Presiding officer', member: 'Member', external_member: 'External member' };

const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
export function addWorkingDays(date: string, n: number): string {
  let d = date;
  for (let left = n; left > 0;) {
    d = addDays(d, 1);
    if (weekday(d) !== 0 && weekday(d) !== 6) left--;
  }
  return d;
}
const daysUntil = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function state(due: string | null, done: string | null, today: string): StepState {
  if (done) return 'done';
  if (!due) return 'open';
  if (today > due) return 'overdue';
  return daysUntil(today, due) <= 3 ? 'due_soon' : 'open';
}

/** The steps of a complaint with their due dates and where each stands today. */
export function poshTimeline(c: { filedOn: string; incidentOn: string | null; steps: PoshSteps | null; today: string }): TimelineRow[] {
  const s = c.steps;
  const at = (k: keyof PoshSteps) => s?.[k] ?? null;
  const limit = c.incidentOn ? addMonths(c.incidentOn, 3) : null;
  const extendedLimit = c.incidentOn ? addMonths(c.incidentOn, 6) : null;
  const filedInTime = !limit || c.filedOn <= limit || (!!at('filing_extended_on') && c.filedOn <= extendedLimit!);
  const settled = at('conciliation_settled_on');
  const step = (key: PoshStep, label: string, rule: string, due: string | null): TimelineRow =>
    ({ key, step: key, label, rule, due, done: at(`${key}_on` as keyof PoshSteps), state: settled ? 'not_needed' : state(due, at(`${key}_on` as keyof PoshSteps), c.today) });
  const report = at('report_sent_on');
  return [
    { key: 'filing', step: 'filing_extended', label: 'Complaint made within three months', rule: 'Section 9: within three months of the incident, or of the last one in a series; the committee can extend this by three more, with its reasons in writing.',
      due: limit, done: c.filedOn, state: filedInTime ? 'done' : 'late' },
    { key: 'conciliation_requested', step: 'conciliation_requested', label: 'Conciliation asked for', rule: 'Section 10: only at the complainant’s request, before the inquiry; no money settlement.', due: null,
      done: at('conciliation_requested_on'), state: at('conciliation_requested_on') ? 'done' : 'optional' },
    { key: 'conciliation_settled', step: 'conciliation_settled', label: 'Settled by conciliation', rule: 'Section 10(4): once settled, no inquiry follows; the complainant and the respondent get a copy of the settlement.', due: null,
      done: settled, state: settled ? 'done' : 'optional' },
    step('notice_sent', 'Copy of the complaint to the respondent', 'Rule 7: within 7 working days of receiving the complaint.', addWorkingDays(c.filedOn, 7)),
    step('reply_received', 'The respondent’s reply', 'Rule 7: within 10 working days of receiving the copy.', at('notice_sent_on') ? addWorkingDays(at('notice_sent_on')!, 10) : null),
    step('inquiry_completed', 'Inquiry completed', 'Section 11(4): within 90 days of the complaint.', addDays(c.filedOn, 90)),
    step('report_sent', 'Findings reported to the employer', 'Section 13: within 10 days of completing the inquiry.', at('inquiry_completed_on') ? addDays(at('inquiry_completed_on')!, 10) : null),
    step('action_taken', 'Employer acts on the recommendations', 'Section 13(4): within 60 days of the report.', report ? addDays(report, 60) : null),
    { key: 'appeal', step: null, label: 'Appeal window', rule: 'Section 18: either side may appeal within 90 days of the recommendations.', due: report ? addDays(report, 90) : null,
      done: null, state: settled ? 'not_needed' : report && c.today > addDays(report, 90) ? 'done' : 'open' },
  ];
}

export interface CommitteeMember { role: string; employee_id: string | null; woman: boolean; term_from: string; term_until: string }

/** What the committee's make-up still needs (section 4), for the members serving on `today`. */
export function committeeGaps(members: CommitteeMember[], today: string): string[] {
  const now = members.filter((m) => m.term_from <= today && today <= m.term_until);
  const gaps: string[] = [];
  const presiding = now.filter((m) => m.role === 'presiding_officer');
  if (presiding.length === 0) gaps.push('Appoint a presiding officer: a woman employed at a senior level.');
  if (presiding.length > 1) gaps.push('Only one presiding officer can serve at a time.');
  if (now.filter((m) => m.role === 'member').length < 2) gaps.push('Add at least two members from among the employees.');
  if (!now.some((m) => m.role === 'external_member')) gaps.push('Add an external member from an NGO or association, or someone familiar with sexual harassment issues.');
  if (now.length > 0 && now.filter((m) => m.woman).length * 2 < now.length) gaps.push('At least half the members must be women.');
  const soon = now.filter((m) => daysUntil(today, m.term_until) <= 60);
  if (soon.length) gaps.push(`${soon.length} member${soon.length === 1 ? '’s term ends' : 's’ terms end'} within 60 days: plan the reconstitution.`);
  return gaps;
}
