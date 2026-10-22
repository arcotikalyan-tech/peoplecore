import { describe, expect, it } from 'vitest';
import { addWorkingDays, committeeGaps, poshTimeline, type PoshSteps } from './posh';

const none: PoshSteps = {
  filing_extended_on: null, conciliation_requested_on: null, conciliation_settled_on: null, notice_sent_on: null, reply_received_on: null,
  inquiry_completed_on: null, report_sent_on: null, action_taken_on: null, action_kind: null,
};
const row = (rows: ReturnType<typeof poshTimeline>, key: string) => rows.find((r) => r.key === key)!;

describe('addWorkingDays', () => {
  it('skips weekends', () => {
    expect(addWorkingDays('2026-10-22', 7)).toBe('2026-11-02'); // Thursday + 7 working days
    expect(addWorkingDays('2026-10-24', 1)).toBe('2026-10-26'); // Saturday → Monday
  });
});

describe('poshTimeline', () => {
  it('works out each statutory step from the complaint and what has been recorded', () => {
    const rows = poshTimeline({ filedOn: '2026-10-01', incidentOn: '2026-09-20', today: '2026-10-22', steps: { ...none, notice_sent_on: '2026-10-08' } });
    expect(row(rows, 'filing')).toMatchObject({ due: '2026-12-20', state: 'done' });
    expect(row(rows, 'notice_sent')).toMatchObject({ due: '2026-10-12', done: '2026-10-08', state: 'done' });
    expect(row(rows, 'reply_received')).toMatchObject({ due: '2026-10-22', state: 'due_soon' });
    expect(row(rows, 'inquiry_completed')).toMatchObject({ due: '2026-12-30', state: 'open' });
    expect(row(rows, 'report_sent')).toMatchObject({ due: null, state: 'open' });
    expect(row(rows, 'conciliation_requested').state).toBe('optional');
  });

  it('flags a late complaint unless the committee extended the limit, and overdue steps', () => {
    const late = poshTimeline({ filedOn: '2026-10-01', incidentOn: '2026-05-01', today: '2026-10-22', steps: none });
    expect(row(late, 'filing').state).toBe('late');
    expect(row(late, 'notice_sent')).toMatchObject({ due: '2026-10-12', state: 'overdue' });
    expect(row(poshTimeline({ filedOn: '2026-10-01', incidentOn: '2026-05-01', today: '2026-10-22', steps: { ...none, filing_extended_on: '2026-10-02' } }), 'filing').state).toBe('done');
    expect(row(poshTimeline({ filedOn: '2026-10-01', incidentOn: '2026-03-01', today: '2026-10-22', steps: { ...none, filing_extended_on: '2026-10-02' } }), 'filing').state).toBe('late'); // beyond six months
  });

  it('follows the report with the employer’s 60 days and the 90-day appeal window; a settlement ends the inquiry', () => {
    const rows = poshTimeline({ filedOn: '2026-05-01', incidentOn: null, today: '2026-10-22',
      steps: { ...none, notice_sent_on: '2026-05-05', reply_received_on: '2026-05-12', inquiry_completed_on: '2026-07-20', report_sent_on: '2026-07-25' } });
    expect(row(rows, 'action_taken')).toMatchObject({ due: '2026-09-23', state: 'overdue' });
    expect(row(rows, 'appeal')).toMatchObject({ due: '2026-10-23', state: 'open' });
    const settled = poshTimeline({ filedOn: '2026-10-01', incidentOn: null, today: '2026-10-22', steps: { ...none, conciliation_requested_on: '2026-10-02', conciliation_settled_on: '2026-10-05' } });
    expect(['notice_sent', 'inquiry_completed', 'action_taken', 'appeal'].map((k) => row(settled, k).state)).toEqual(['not_needed', 'not_needed', 'not_needed', 'not_needed']);
  });
});

describe('committeeGaps', () => {
  const m = (role: string, woman: boolean, until = '2028-01-01') => ({ role, employee_id: role === 'external_member' ? null : 'e', woman, term_from: '2026-01-01', term_until: until });
  it('checks the make-up section 4 asks for', () => {
    expect(committeeGaps([], '2026-10-22')).toEqual([
      'Appoint a presiding officer: a woman employed at a senior level.', 'Add at least two members from among the employees.',
      'Add an external member from an NGO or association, or someone familiar with sexual harassment issues.',
    ]);
    expect(committeeGaps([m('presiding_officer', true), m('member', false), m('member', true), m('external_member', false)], '2026-10-22')).toEqual([]);
    expect(committeeGaps([m('presiding_officer', true), m('member', false), m('member', false), m('external_member', false)], '2026-10-22'))
      .toEqual(['At least half the members must be women.']);
    expect(committeeGaps([m('presiding_officer', true, '2026-11-30'), m('member', true), m('member', true), m('external_member', false)], '2026-10-22'))
      .toEqual(['1 member’s term ends within 60 days: plan the reconstitution.']);
  });
});
