/**
 * Statutory compliance catalogue and engine (Compliance › Overview, Calendar, Documents, Library, Regime Map, Engine).
 *
 * Forms are data: each entry says what the artifact is, which law and jurisdiction it belongs to, how often it is due,
 * when it applies (headcount thresholds, PF/ESI/PT, contract labour, factory) and, where PeopleCore can produce it,
 * which report renders it. The engine below turns the catalogue and an organization's facts into obligations with due
 * dates. Nothing here is legal advice: every entry carries a confidence level, and the app asks people to have a
 * compliance expert verify a form before filing it.
 */

export type StateCode =
  | 'AN' | 'AP' | 'AR' | 'AS' | 'BR' | 'CH' | 'CG' | 'DH' | 'DL' | 'GA' | 'GJ' | 'HR' | 'HP' | 'JK' | 'JH' | 'KA' | 'KL'
  | 'LA' | 'LD' | 'MP' | 'MH' | 'MN' | 'ML' | 'MZ' | 'NL' | 'OD' | 'PY' | 'PB' | 'RJ' | 'SK' | 'TN' | 'TS' | 'TR' | 'UP'
  | 'UK' | 'WB';
export type Jurisdiction = 'IN' | StateCode;

export interface StateInfo { name: string; ut?: boolean; pt: boolean; lwf: boolean; detailed?: boolean }

/** Every state and UT, with whether it levies Professional Tax and runs a Labour Welfare Fund. */
export const STATES: Record<StateCode, StateInfo> = {
  AN: { name: 'Andaman & Nicobar Islands', ut: true, pt: false, lwf: false },
  AP: { name: 'Andhra Pradesh', pt: true, lwf: true, detailed: true },
  AR: { name: 'Arunachal Pradesh', pt: false, lwf: false },
  AS: { name: 'Assam', pt: true, lwf: false },
  BR: { name: 'Bihar', pt: true, lwf: false },
  CH: { name: 'Chandigarh', ut: true, pt: false, lwf: true },
  CG: { name: 'Chhattisgarh', pt: false, lwf: true },
  DH: { name: 'Dadra & Nagar Haveli and Daman & Diu', ut: true, pt: false, lwf: false },
  DL: { name: 'Delhi', ut: true, pt: false, lwf: true, detailed: true },
  GA: { name: 'Goa', pt: false, lwf: true },
  GJ: { name: 'Gujarat', pt: true, lwf: true, detailed: true },
  HR: { name: 'Haryana', pt: false, lwf: true, detailed: true },
  HP: { name: 'Himachal Pradesh', pt: false, lwf: false },
  JK: { name: 'Jammu & Kashmir', ut: true, pt: false, lwf: false },
  JH: { name: 'Jharkhand', pt: true, lwf: false },
  KA: { name: 'Karnataka', pt: true, lwf: true, detailed: true },
  KL: { name: 'Kerala', pt: true, lwf: true, detailed: true },
  LA: { name: 'Ladakh', ut: true, pt: false, lwf: false },
  LD: { name: 'Lakshadweep', ut: true, pt: false, lwf: false },
  MP: { name: 'Madhya Pradesh', pt: true, lwf: true },
  MH: { name: 'Maharashtra', pt: true, lwf: true, detailed: true },
  MN: { name: 'Manipur', pt: true, lwf: false },
  ML: { name: 'Meghalaya', pt: true, lwf: false },
  MZ: { name: 'Mizoram', pt: true, lwf: false },
  NL: { name: 'Nagaland', pt: true, lwf: false },
  OD: { name: 'Odisha', pt: true, lwf: true },
  PY: { name: 'Puducherry', ut: true, pt: true, lwf: false },
  PB: { name: 'Punjab', pt: true, lwf: true },
  RJ: { name: 'Rajasthan', pt: false, lwf: false },
  SK: { name: 'Sikkim', pt: true, lwf: false },
  TN: { name: 'Tamil Nadu', pt: true, lwf: true, detailed: true },
  TS: { name: 'Telangana', pt: true, lwf: true, detailed: true },
  TR: { name: 'Tripura', pt: true, lwf: false },
  UP: { name: 'Uttar Pradesh', pt: false, lwf: false, detailed: true },
  UK: { name: 'Uttarakhand', pt: false, lwf: false },
  WB: { name: 'West Bengal', pt: true, lwf: true, detailed: true },
};
export const isStateCode = (v: string | null | undefined): v is StateCode => !!v && v in STATES;
export const jurisdictionName = (j: Jurisdiction) => (j === 'IN' ? 'Central' : STATES[j].name);

export type FormClass = 'register' | 'return' | 'registration' | 'slip' | 'notice' | 'challan';
export const FORM_CLASSES: Record<FormClass, string> = {
  register: 'Register', return: 'Return', registration: 'Registration', slip: 'Wage slip / letter', notice: 'Notice / abstract', challan: 'Challan / payment',
};
export type Regime = 'labour_code' | 'continuing' | 'legacy' | 'state_fiscal' | 'state_welfare';
export const REGIMES: Record<Regime, string> = {
  labour_code: 'Labour Code', continuing: 'Both / continuing', legacy: 'Legacy', state_fiscal: 'State fiscal law', state_welfare: 'State welfare law',
};
export type Confidence = 'high' | 'medium' | 'low';

/**
 * When an obligation falls due.
 * - monthly: for each month, `day` of the next month ('last' = its last day); `sameMonth` puts it in the month itself;
 *   `march` overrides the date for the March period (MM-DD of the next month or later).
 * - quarterly (financial-year quarters), half_yearly and annual: the first `due` MM-DD after the period ends.
 * - continuous registers, per-event forms (joiners, exits, accidents) and one-time registrations have no calendar date.
 */
export type DueRule =
  | { kind: 'monthly'; day: number | 'last'; sameMonth?: boolean; march?: string }
  | { kind: 'quarterly'; due: [string, string, string, string] }
  | { kind: 'half_yearly'; basis: 'calendar' | 'fy'; due: [string, string] }
  | { kind: 'annual'; basis: 'calendar' | 'fy'; due: string }
  | { kind: 'continuous' } | { kind: 'event' } | { kind: 'one_time' };

export type Need = 'pf' | 'esi' | 'pt' | 'lwf' | 'tds' | 'vendor_tds' | 'contract' | 'factory';

/** What PeopleCore uses to produce the artifact: a report in Reports, or a page. */
export type Renderer = { report: string } | { page: 'payslips' | 'tax' | 'letters' | 'holidays' };

export interface StatForm {
  id: string;
  name: string;
  form: string;
  act: string;
  jurisdiction: Jurisdiction;
  cls: FormClass;
  regime: Regime;
  frequency: string;
  due: DueRule;
  trigger: string;
  source: string;
  confidence: Confidence;
  /** Headcount threshold (organization-wide for central forms, in the state for state forms) and other conditions. */
  min?: number;
  needs?: Need[];
  /** Only in force from / until (wage periods outside are ignored). */
  from?: string;
  until?: string;
  render?: Renderer;
  /** Needs a locked payroll run for the wage period before it can be rendered. */
  payroll?: boolean;
}

const LABOUR_CODES_FROM = '2025-11-21';

const central: StatForm[] = [
  // Code on Wages, 2019 and the Central Rules.
  { id: 'IN-W-01', name: 'Employee register', form: 'Form I', act: 'Code on Wages + Central Rules', jurisdiction: 'IN', cls: 'register', regime: 'labour_code', frequency: 'Ongoing', due: { kind: 'continuous' }, trigger: 'Continuous; 5-year retention', source: 'Employee master', confidence: 'high', from: LABOUR_CODES_FROM, render: { report: 'employee_master' } },
  { id: 'IN-W-02', name: 'Register of wages, overtime, fines and deductions', form: 'Form IV', act: 'Code on Wages + Central Rules', jurisdiction: 'IN', cls: 'register', regime: 'labour_code', frequency: 'Monthly', due: { kind: 'monthly', day: 7 }, trigger: 'Each wage period; 5-year retention', source: 'Payroll run', confidence: 'high', from: LABOUR_CODES_FROM, render: { report: 'gross_vs_net' }, payroll: true },
  { id: 'IN-W-03', name: 'Wage slip', form: 'Form V', act: 'Code on Wages + Central Rules', jurisdiction: 'IN', cls: 'slip', regime: 'labour_code', frequency: 'Per payroll run', due: { kind: 'monthly', day: 7 }, trigger: 'On or before paying wages (by the 7th)', source: 'Payroll run', confidence: 'high', from: LABOUR_CODES_FROM, render: { page: 'payslips' }, payroll: true },
  { id: 'IN-W-04', name: 'Attendance register-cum-muster roll', form: 'Form IX', act: 'Code on Wages + Central Rules', jurisdiction: 'IN', cls: 'register', regime: 'labour_code', frequency: 'Monthly', due: { kind: 'monthly', day: 7 }, trigger: 'Continuous; 5-year retention', source: 'Attendance', confidence: 'high', from: LABOUR_CODES_FROM, render: { report: 'muster_roll' } },
  { id: 'IN-W-05', name: 'Annual return under the Wages Code', form: 'Unified return', act: 'Code on Wages + Central Rules', jurisdiction: 'IN', cls: 'return', regime: 'labour_code', frequency: 'Annual', due: { kind: 'annual', basis: 'calendar', due: '02-01' }, trigger: 'By 1 February for the previous calendar year (verify)', source: 'Payroll aggregates', confidence: 'low', from: LABOUR_CODES_FROM },
  { id: 'IN-W-06', name: 'Appointment letter (prescribed format)', form: 'Appointment letter', act: 'Labour Codes', jurisdiction: 'IN', cls: 'slip', regime: 'labour_code', frequency: 'Per joiner', due: { kind: 'event' }, trigger: 'On appointment', source: 'Onboarding', confidence: 'medium', from: LABOUR_CODES_FROM, render: { page: 'letters' } },
  // OSH Code / IR Code.
  { id: 'IN-O-01', name: 'Annual integrated return', form: 'Integrated return', act: 'OSH & Working Conditions Code', jurisdiction: 'IN', cls: 'return', regime: 'labour_code', frequency: 'Annual', due: { kind: 'annual', basis: 'calendar', due: '02-01' }, trigger: 'By 1 February (verify against the Central Rules)', source: 'Payroll + HR data', confidence: 'low', min: 10, from: LABOUR_CODES_FROM },
  { id: 'IN-O-02', name: 'Annual return of a factory', form: 'Annual return', act: 'OSH & Working Conditions Code (factories)', jurisdiction: 'IN', cls: 'return', regime: 'labour_code', frequency: 'Annual', due: { kind: 'annual', basis: 'calendar', due: '01-31' }, trigger: 'By 31 January', source: 'Payroll + attendance', confidence: 'medium', needs: ['factory'], from: LABOUR_CODES_FROM },
  { id: 'IN-I-01', name: 'Standing orders certification', form: 'Standing orders', act: 'Industrial Relations Code', jurisdiction: 'IN', cls: 'registration', regime: 'labour_code', frequency: 'One-time + on change', due: { kind: 'one_time' }, trigger: 'Establishments with 300 or more workers', source: 'Company profile', confidence: 'medium', min: 300, from: LABOUR_CODES_FROM },
  // Legacy central registers that continue where states have not notified the codes.
  { id: 'IN-L-01', name: 'Combined registers (employees, wages, deductions, attendance)', form: 'Forms A–E', act: 'Ease of Compliance Rules 2017', jurisdiction: 'IN', cls: 'register', regime: 'legacy', frequency: 'Ongoing', due: { kind: 'continuous' }, trigger: 'Continuous', source: 'Payroll + attendance', confidence: 'medium', render: { report: 'form_d' } },
  // EPF & MP Act (continues as the Social Security Code takes effect).
  { id: 'IN-P-01', name: 'PF electronic challan-cum-return', form: 'ECR', act: 'EPF & MP Act', jurisdiction: 'IN', cls: 'challan', regime: 'continuing', frequency: 'Monthly', due: { kind: 'monthly', day: 15 }, trigger: '15th of the following month', source: 'Payroll run', confidence: 'high', needs: ['pf'], render: { report: 'pf_ecr' }, payroll: true },
  { id: 'IN-P-02', name: 'PF register', form: 'PF register', act: 'EPF & MP Act', jurisdiction: 'IN', cls: 'register', regime: 'continuing', frequency: 'Monthly', due: { kind: 'monthly', day: 15 }, trigger: 'Each wage period', source: 'Payroll run', confidence: 'high', needs: ['pf'], render: { report: 'pf_register' }, payroll: true },
  { id: 'IN-P-03', name: 'Composite declaration (new joiner)', form: 'Form 11', act: 'EPF Scheme', jurisdiction: 'IN', cls: 'slip', regime: 'continuing', frequency: 'Per joiner', due: { kind: 'event' }, trigger: 'On joining', source: 'Onboarding', confidence: 'high', needs: ['pf'] },
  { id: 'IN-P-04', name: 'PF nomination and declaration', form: 'Form 2', act: 'EPF Scheme', jurisdiction: 'IN', cls: 'slip', regime: 'continuing', frequency: 'Per joiner', due: { kind: 'event' }, trigger: 'On joining (e-nomination on the UAN portal)', source: 'Onboarding', confidence: 'high', needs: ['pf'] },
  { id: 'IN-P-05', name: 'Return of ownership', form: 'Form 5A', act: 'EPF Scheme', jurisdiction: 'IN', cls: 'return', regime: 'continuing', frequency: 'Event', due: { kind: 'event' }, trigger: 'On registration and on any change', source: 'Company profile', confidence: 'high', needs: ['pf'] },
  { id: 'IN-P-06', name: 'PF withdrawal / settlement on exit', form: 'Form 19 / 10C', act: 'EPF Scheme', jurisdiction: 'IN', cls: 'slip', regime: 'continuing', frequency: 'Per exit', due: { kind: 'event' }, trigger: 'When a member leaves (filed online by the member)', source: 'Separations', confidence: 'high', needs: ['pf'] },
  // ESI Act.
  { id: 'IN-E-01', name: 'ESI monthly contribution', form: 'ESI challan', act: 'ESI Act', jurisdiction: 'IN', cls: 'challan', regime: 'continuing', frequency: 'Monthly', due: { kind: 'monthly', day: 15 }, trigger: '15th of the following month', source: 'Payroll run', confidence: 'high', needs: ['esi'], render: { report: 'esi_contribution' }, payroll: true },
  { id: 'IN-E-02', name: 'ESI registration of an employee', form: 'Form 1', act: 'ESI (General) Regulations', jurisdiction: 'IN', cls: 'registration', regime: 'continuing', frequency: 'Per joiner', due: { kind: 'event' }, trigger: 'Within 10 days of joining', source: 'Onboarding', confidence: 'high', needs: ['esi'] },
  { id: 'IN-E-03', name: 'Accident report', form: 'Form 12', act: 'ESI (General) Regulations', jurisdiction: 'IN', cls: 'return', regime: 'continuing', frequency: 'Event', due: { kind: 'event' }, trigger: 'Within 24 hours of an accident', source: 'HR', confidence: 'high', needs: ['esi'] },
  { id: 'IN-E-04', name: 'Accident book', form: 'Form 15', act: 'ESI (General) Regulations', jurisdiction: 'IN', cls: 'register', regime: 'continuing', frequency: 'Ongoing', due: { kind: 'continuous' }, trigger: 'Continuous', source: 'HR', confidence: 'medium', needs: ['esi'] },
  // Income tax (TDS on salary).
  { id: 'IN-T-01', name: 'TDS on salary deposit', form: 'Challan 281', act: 'Income-tax Act', jurisdiction: 'IN', cls: 'challan', regime: 'continuing', frequency: 'Monthly', due: { kind: 'monthly', day: 7, march: '04-30' }, trigger: '7th of the following month (30 April for March)', source: 'Payroll run', confidence: 'high', needs: ['tds'], render: { report: 'tds_report' }, payroll: true },
  { id: 'IN-T-02', name: 'Quarterly TDS return on salary', form: 'Form 24Q', act: 'Income-tax Act', jurisdiction: 'IN', cls: 'return', regime: 'continuing', frequency: 'Quarterly', due: { kind: 'quarterly', due: ['07-31', '10-31', '01-31', '05-31'] }, trigger: '31 Jul, 31 Oct, 31 Jan, 31 May', source: 'Payroll runs', confidence: 'high', needs: ['tds'], render: { report: 'form_24q' }, payroll: true },
  { id: 'IN-T-03', name: 'Salary TDS certificate', form: 'Form 16', act: 'Income-tax Act', jurisdiction: 'IN', cls: 'slip', regime: 'continuing', frequency: 'Annual', due: { kind: 'annual', basis: 'fy', due: '06-15' }, trigger: 'By 15 June after the financial year', source: 'Payroll runs', confidence: 'high', needs: ['tds'], render: { report: 'form_16' }, payroll: true },
  { id: 'IN-T-04', name: 'Employee investment declaration', form: 'Form 12BB', act: 'Income-tax Rules', jurisdiction: 'IN', cls: 'slip', regime: 'continuing', frequency: 'Annual', due: { kind: 'event' }, trigger: 'Collected from employees during the year', source: 'Tax declarations', confidence: 'high', needs: ['tds'], render: { page: 'tax' } },
  // Payment of Gratuity Act.
  { id: 'IN-G-01', name: 'Notice of opening (gratuity)', form: 'Form A', act: 'Payment of Gratuity Act', jurisdiction: 'IN', cls: 'registration', regime: 'continuing', frequency: 'One-time', due: { kind: 'one_time' }, trigger: 'Within 30 days of becoming applicable', source: 'Company profile', confidence: 'medium', min: 10 },
  { id: 'IN-G-02', name: 'Gratuity nomination', form: 'Form F', act: 'Payment of Gratuity Act', jurisdiction: 'IN', cls: 'slip', regime: 'continuing', frequency: 'Per joiner', due: { kind: 'event' }, trigger: 'Within 30 days of completing one year of service', source: 'Onboarding', confidence: 'high', min: 10 },
  // Payment of Bonus Act.
  { id: 'IN-B-01', name: 'Bonus register', form: 'Form C', act: 'Payment of Bonus Act', jurisdiction: 'IN', cls: 'register', regime: 'continuing', frequency: 'Annual', due: { kind: 'annual', basis: 'fy', due: '11-30' }, trigger: 'Within 8 months of the year end', source: 'Payroll runs', confidence: 'medium', min: 20, payroll: true },
  { id: 'IN-B-02', name: 'Annual bonus return', form: 'Form D', act: 'Payment of Bonus Act', jurisdiction: 'IN', cls: 'return', regime: 'continuing', frequency: 'Annual', due: { kind: 'annual', basis: 'fy', due: '02-01' }, trigger: 'Within 30 days of paying the bonus (by 1 February)', source: 'Payroll runs', confidence: 'medium', min: 20, payroll: true },
  // Maternity Benefit Act.
  { id: 'IN-M-01', name: 'Maternity benefit register', form: 'Form A', act: 'Maternity Benefit Act', jurisdiction: 'IN', cls: 'register', regime: 'continuing', frequency: 'Ongoing', due: { kind: 'continuous' }, trigger: 'Continuous', source: 'Leave', confidence: 'medium', min: 10 },
  { id: 'IN-M-02', name: 'Abstract of the Maternity Benefit Act (display)', form: 'Abstract', act: 'Maternity Benefit Act', jurisdiction: 'IN', cls: 'notice', regime: 'continuing', frequency: 'On change', due: { kind: 'continuous' }, trigger: 'Displayed at the premises', source: 'Company profile', confidence: 'medium', min: 10 },
  // Contract labour (only when contract workers are engaged).
  { id: 'IN-C-01', name: 'Registration as principal employer', form: 'Registration', act: 'OSH Code (contract labour)', jurisdiction: 'IN', cls: 'registration', regime: 'labour_code', frequency: 'One-time', due: { kind: 'one_time' }, trigger: 'Before engaging contract labour', source: 'Contractors', confidence: 'medium', needs: ['contract'] },
  { id: 'IN-C-02', name: 'Register of contractors', form: 'Form XII', act: 'CLRA Central Rules 1971', jurisdiction: 'IN', cls: 'register', regime: 'legacy', frequency: 'Ongoing', due: { kind: 'continuous' }, trigger: 'Continuous', source: 'Contractors', confidence: 'high', needs: ['contract'] },
  { id: 'IN-C-03', name: 'Half-yearly return by contractor', form: 'Form XXIV', act: 'CLRA Central Rules 1971', jurisdiction: 'IN', cls: 'return', regime: 'legacy', frequency: 'Half-yearly', due: { kind: 'half_yearly', basis: 'calendar', due: ['07-30', '01-30'] }, trigger: 'Within 30 days of the half-year end', source: 'Contractors', confidence: 'high', needs: ['contract'] },
  { id: 'IN-C-04', name: 'Annual return by principal employer', form: 'Form XXV', act: 'CLRA Central Rules 1971', jurisdiction: 'IN', cls: 'return', regime: 'legacy', frequency: 'Annual', due: { kind: 'annual', basis: 'calendar', due: '02-15' }, trigger: 'By 15 February', source: 'Contractors', confidence: 'high', needs: ['contract'] },
  // TDS on payments other than salary (vendors, contractors, professionals, rent).
  { id: 'IN-T-05', name: 'TDS deposit on vendor and other payments', form: 'Challan 281', act: 'Income-tax Act', jurisdiction: 'IN', cls: 'challan', regime: 'continuing', frequency: 'Monthly', due: { kind: 'monthly', day: 7, march: '04-30' }, trigger: '7th of the following month; March by 30 April', source: 'Vendor payouts', confidence: 'high', needs: ['vendor_tds'] },
  { id: 'IN-T-06', name: 'Quarterly TDS return on vendor and other payments', form: 'Form 26Q', act: 'Income-tax Act', jurisdiction: 'IN', cls: 'return', regime: 'continuing', frequency: 'Quarterly', due: { kind: 'quarterly', due: ['07-31', '10-31', '01-31', '05-31'] }, trigger: '31 Jul, 31 Oct, 31 Jan, 31 May', source: 'Vendor payouts', confidence: 'high', needs: ['vendor_tds'] },
  { id: 'IN-T-07', name: 'TDS certificate for vendors', form: 'Form 16A', act: 'Income-tax Act', jurisdiction: 'IN', cls: 'slip', regime: 'continuing', frequency: 'Quarterly', due: { kind: 'quarterly', due: ['08-15', '11-15', '02-15', '06-15'] }, trigger: 'Within 15 days of the Form 26Q due date', source: 'Vendor payouts', confidence: 'high', needs: ['vendor_tds'] },
  { id: 'IN-T-08', name: 'Statement of perquisites', form: 'Form 12BA', act: 'Income-tax Rules', jurisdiction: 'IN', cls: 'slip', regime: 'continuing', frequency: 'Annual', due: { kind: 'annual', basis: 'fy', due: '06-15' }, trigger: 'With Form 16, for employees given perquisites', source: 'Payroll runs', confidence: 'medium', needs: ['tds'], payroll: true },
  { id: 'IN-T-09', name: 'Tax deduction account number (TAN)', form: 'Form 49B', act: 'Income-tax Act', jurisdiction: 'IN', cls: 'registration', regime: 'continuing', frequency: 'One-time', due: { kind: 'one_time' }, trigger: 'Before deducting any TDS', source: 'Company profile', confidence: 'high', needs: ['tds'] },
  // Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013.
  { id: 'IN-H-01', name: 'Constitution of the Internal Committee', form: 'IC order', act: 'POSH Act 2013', jurisdiction: 'IN', cls: 'registration', regime: 'continuing', frequency: 'One-time + every 3 years', due: { kind: 'one_time' }, trigger: 'Workplaces with 10 or more employees; members serve up to three years', source: 'HR', confidence: 'high', min: 10 },
  { id: 'IN-H-02', name: 'Display of the Internal Committee and the penalties for sexual harassment', form: 'Display', act: 'POSH Act 2013', jurisdiction: 'IN', cls: 'notice', regime: 'continuing', frequency: 'On change', due: { kind: 'continuous' }, trigger: 'Displayed at a conspicuous place', source: 'HR', confidence: 'high', min: 10 },
  { id: 'IN-H-03', name: 'Annual report of the Internal Committee', form: 'Annual report', act: 'POSH Act 2013 + Rules', jurisdiction: 'IN', cls: 'return', regime: 'continuing', frequency: 'Annual', due: { kind: 'annual', basis: 'calendar', due: '01-31' }, trigger: 'For each calendar year, to the employer and the District Officer (date varies by state; verify)', source: 'HR', confidence: 'medium', min: 10 },
  // Industrial Relations Code.
  { id: 'IN-I-02', name: 'Grievance Redressal Committee', form: 'Committee', act: 'Industrial Relations Code', jurisdiction: 'IN', cls: 'registration', regime: 'labour_code', frequency: 'One-time', due: { kind: 'one_time' }, trigger: 'Establishments with 20 or more workers', source: 'HR', confidence: 'medium', min: 20, from: LABOUR_CODES_FROM },
  { id: 'IN-I-03', name: 'Works committee', form: 'Committee', act: 'Industrial Relations Code', jurisdiction: 'IN', cls: 'registration', regime: 'labour_code', frequency: 'One-time', due: { kind: 'one_time' }, trigger: 'Establishments with 100 or more workers, when the government orders it', source: 'HR', confidence: 'medium', min: 100, from: LABOUR_CODES_FROM },
  { id: 'IN-I-04', name: 'Notice of change in service conditions', form: 'Notice of change', act: 'Industrial Relations Code', jurisdiction: 'IN', cls: 'notice', regime: 'labour_code', frequency: 'Event', due: { kind: 'event' }, trigger: '21 days before changing conditions such as wages, hours or leave', source: 'HR', confidence: 'medium', from: LABOUR_CODES_FROM },
  // Gratuity, bonus and maternity: the other forms.
  { id: 'IN-G-03', name: 'Notice of change (gratuity)', form: 'Form B', act: 'Payment of Gratuity Act', jurisdiction: 'IN', cls: 'registration', regime: 'continuing', frequency: 'Event', due: { kind: 'event' }, trigger: 'Within 30 days of a change in name, address, employer or business', source: 'Company profile', confidence: 'medium', min: 10 },
  { id: 'IN-G-04', name: 'Notice of gratuity payable', form: 'Form L', act: 'Payment of Gratuity Act', jurisdiction: 'IN', cls: 'slip', regime: 'continuing', frequency: 'Per exit', due: { kind: 'event' }, trigger: 'Within 15 days of the employee’s application; pay within 30 days of it falling due', source: 'Full and final settlement', confidence: 'medium', min: 10 },
  { id: 'IN-G-05', name: 'Abstract of the Payment of Gratuity Act (display)', form: 'Form U', act: 'Payment of Gratuity Act', jurisdiction: 'IN', cls: 'notice', regime: 'continuing', frequency: 'On change', due: { kind: 'continuous' }, trigger: 'Displayed at the premises', source: 'Admin', confidence: 'medium', min: 10 },
  { id: 'IN-B-03', name: 'Computation of the allocable surplus', form: 'Form A', act: 'Payment of Bonus Act', jurisdiction: 'IN', cls: 'register', regime: 'continuing', frequency: 'Annual', due: { kind: 'annual', basis: 'fy', due: '11-30' }, trigger: 'With the bonus, within 8 months of the year end', source: 'Accounts', confidence: 'medium', min: 20 },
  { id: 'IN-B-04', name: 'Set-on and set-off of the allocable surplus', form: 'Form B', act: 'Payment of Bonus Act', jurisdiction: 'IN', cls: 'register', regime: 'continuing', frequency: 'Annual', due: { kind: 'annual', basis: 'fy', due: '11-30' }, trigger: 'With the bonus, within 8 months of the year end', source: 'Accounts', confidence: 'medium', min: 20 },
  { id: 'IN-M-03', name: 'Written intimation of maternity benefits', form: 'Intimation', act: 'Maternity Benefit Act', jurisdiction: 'IN', cls: 'slip', regime: 'continuing', frequency: 'Per joiner', due: { kind: 'event' }, trigger: 'To every woman employee, in writing and electronically, at appointment', source: 'Onboarding', confidence: 'high', min: 10 },
  // Other central obligations.
  { id: 'IN-X-01', name: 'Quarterly vacancy return', form: 'ER-I', act: 'Employment Exchanges (CNV) Act', jurisdiction: 'IN', cls: 'return', regime: 'legacy', frequency: 'Quarterly', due: { kind: 'quarterly', due: ['07-30', '10-30', '01-30', '04-30'] }, trigger: 'Within 30 days of each quarter (private establishments with 25+ employees)', source: 'Employee master', confidence: 'medium', min: 25, until: LABOUR_CODES_FROM },
  { id: 'IN-X-02', name: 'Equal opportunity policy for persons with disabilities', form: 'Policy', act: 'Rights of Persons with Disabilities Act 2016', jurisdiction: 'IN', cls: 'notice', regime: 'continuing', frequency: 'One-time + on change', due: { kind: 'one_time' }, trigger: 'Published by the establishment (registration and size rules vary; verify)', source: 'Policies', confidence: 'medium' },
  { id: 'IN-X-03', name: 'Complaints officer under the HIV and AIDS Act', form: 'Designation', act: 'HIV and AIDS (Prevention and Control) Act 2017', jurisdiction: 'IN', cls: 'registration', regime: 'continuing', frequency: 'One-time', due: { kind: 'one_time' }, trigger: 'Establishments with 100 or more persons', source: 'HR', confidence: 'medium', min: 100 },
  // Contract labour and factories: the remaining registers.
  { id: 'IN-C-05', name: 'Register of workmen employed by the contractor', form: 'Form XIII', act: 'CLRA Central Rules 1971', jurisdiction: 'IN', cls: 'register', regime: 'legacy', frequency: 'Ongoing', due: { kind: 'continuous' }, trigger: 'Kept by each contractor; checked by the principal employer', source: 'Contractors', confidence: 'medium', needs: ['contract'] },
  { id: 'IN-C-06', name: 'Contractor’s muster roll, wage register and wage slips', form: 'Forms XVI, XVII, XIX', act: 'CLRA Central Rules 1971', jurisdiction: 'IN', cls: 'register', regime: 'legacy', frequency: 'Monthly', due: { kind: 'continuous' }, trigger: 'Each wage period, kept by the contractor', source: 'Contractors', confidence: 'medium', needs: ['contract'] },
  { id: 'IN-F-01', name: 'Factory licence', form: 'Licence', act: 'OSH & Working Conditions Code (factories)', jurisdiction: 'IN', cls: 'registration', regime: 'labour_code', frequency: 'One-time + renewal', due: { kind: 'one_time' }, trigger: 'Before starting manufacturing operations (state rules apply; verify)', source: 'Company profile', confidence: 'medium', needs: ['factory'], from: LABOUR_CODES_FROM },
  // Displays.
  { id: 'IN-N-01', name: 'Abstracts of the Labour Codes (display)', form: 'Abstracts', act: 'Labour Codes', jurisdiction: 'IN', cls: 'notice', regime: 'labour_code', frequency: 'On change', due: { kind: 'continuous' }, trigger: 'Displayed at the premises', source: 'Company profile', confidence: 'medium', from: LABOUR_CODES_FROM },
];

/** The state-level pack for one state: S&E registration and registers, holidays notice, PT and LWF. */
function statePack(code: StateCode, p: {
  se: string; seRegister: string; seRegisterForm: string; seRender?: string; holidays: string;
  pt?: { enrol: string; ret: string; due: DueRule; trigger: string; confidence: Confidence };
  lwf?: { form: string; due: DueRule; trigger: string; confidence: Confidence };
}): StatForm[] {
  const s = STATES[code].name;
  const out: StatForm[] = [
    { id: `${code}-S-01`, name: 'Shops & establishments registration', form: 'Registration', act: p.se, jurisdiction: code, cls: 'registration', regime: 'legacy', frequency: 'One-time + renewal', due: { kind: 'one_time' }, trigger: 'Within 30 days of opening', source: 'Company profile', confidence: 'medium' },
    { id: `${code}-S-02`, name: p.seRegister, form: p.seRegisterForm, act: p.se, jurisdiction: code, cls: 'register', regime: 'legacy', frequency: 'Monthly', due: { kind: 'continuous' }, trigger: 'Continuous', source: 'Payroll + attendance', confidence: 'medium', ...(p.seRender ? { render: { report: p.seRender } } : {}) },
    { id: `${code}-S-03`, name: 'Leave with wages register', form: 'Leave register', act: p.se, jurisdiction: code, cls: 'register', regime: 'legacy', frequency: 'Ongoing', due: { kind: 'continuous' }, trigger: 'Continuous', source: 'Leave', confidence: 'medium', render: { report: 'leave_register' } },
    { id: `${code}-S-04`, name: 'Notice of weekly holiday and working hours', form: 'Display', act: p.se, jurisdiction: code, cls: 'notice', regime: 'legacy', frequency: 'On change', due: { kind: 'continuous' }, trigger: 'Displayed at the premises', source: 'Attendance rules', confidence: 'medium' },
    { id: `${code}-S-05`, name: 'National & festival holidays list', form: 'Intimation + display', act: p.holidays, jurisdiction: code, cls: 'notice', regime: 'legacy', frequency: 'Annual', due: { kind: 'annual', basis: 'calendar', due: '01-31' }, trigger: `Start of the year (${s} due date: verify)`, source: 'Holidays', confidence: 'low', render: { page: 'holidays' } },
  ];
  if (p.pt) out.push(
    { id: `${code}-PT-01`, name: 'Professional tax enrolment and registration (employer)', form: p.pt.enrol, act: `${s} Professional Tax Act`, jurisdiction: code, cls: 'registration', regime: 'state_fiscal', frequency: 'One-time', due: { kind: 'one_time' }, trigger: 'Within 30 days of becoming liable', source: 'Company profile', confidence: 'medium', needs: ['pt'] },
    { id: `${code}-PT-02`, name: 'Professional tax return and payment', form: p.pt.ret, act: `${s} Professional Tax Act`, jurisdiction: code, cls: 'challan', regime: 'state_fiscal', frequency: p.pt.due.kind === 'monthly' ? 'Monthly' : p.pt.due.kind === 'half_yearly' ? 'Half-yearly' : 'Annual', due: p.pt.due, trigger: p.pt.trigger, source: 'Payroll run', confidence: p.pt.confidence, needs: ['pt'], render: { report: 'pt_report' }, payroll: true },
  );
  if (p.lwf) out.push(
    { id: `${code}-LWF-01`, name: 'Labour welfare fund contribution', form: p.lwf.form, act: `${s} Labour Welfare Fund Act`, jurisdiction: code, cls: 'challan', regime: 'state_welfare', frequency: p.lwf.due.kind === 'monthly' ? 'Monthly' : p.lwf.due.kind === 'half_yearly' ? 'Half-yearly' : 'Annual', due: p.lwf.due, trigger: p.lwf.trigger, source: 'Payroll run', confidence: p.lwf.confidence, needs: ['lwf'], payroll: true },
  );
  return out;
}

const HALF_JUL_JAN: DueRule = { kind: 'half_yearly', basis: 'calendar', due: ['07-15', '01-15'] };
const states: StatForm[] = [
  ...statePack('KA', { se: 'Karnataka Shops & Commercial Establishments Act', seRegister: 'Combined muster roll and register of wages', seRegisterForm: 'Form T', seRender: 'form_t', holidays: 'Karnataka Industrial Employment (N&F Holidays) Act',
    pt: { enrol: 'Form 4 / 4A', ret: 'Form 5-A', due: { kind: 'monthly', day: 20 }, trigger: '20th of the following month', confidence: 'medium' },
    lwf: { form: 'Form D', due: { kind: 'annual', basis: 'calendar', due: '01-15' }, trigger: 'By 15 January for the previous year', confidence: 'high' } }),
  ...statePack('MH', { se: 'Maharashtra Shops & Establishments Act', seRegister: 'Register of employment and wages', seRegisterForm: 'Form II', holidays: 'Maharashtra N&F Holidays Act',
    pt: { enrol: 'PTRC / PTEC', ret: 'PTRC return', due: { kind: 'monthly', day: 'last', sameMonth: true }, trigger: 'By the last day of the month (larger employers; others annually)', confidence: 'medium' },
    lwf: { form: 'Form A-1', due: HALF_JUL_JAN, trigger: 'June and December contributions, by 15 July and 15 January', confidence: 'medium' } }),
  ...statePack('TN', { se: 'Tamil Nadu Shops & Establishments Act', seRegister: 'Register of employment and wages', seRegisterForm: 'Form P', holidays: 'Tamil Nadu N&F Holidays Act',
    pt: { enrol: 'Local body registration', ret: 'Half-yearly PT', due: { kind: 'half_yearly', basis: 'fy', due: ['09-30', '03-31'] }, trigger: 'Each half-year (local body collects; verify)', confidence: 'low' },
    lwf: { form: 'Form A', due: { kind: 'annual', basis: 'calendar', due: '01-31' }, trigger: 'By 31 January for the previous year', confidence: 'medium' } }),
  ...statePack('TS', { se: 'Telangana Shops & Establishments Act', seRegister: 'Register of employment and wages', seRegisterForm: 'Form XXIII', holidays: 'Telangana N&F Holidays Act',
    pt: { enrol: 'Form I / II', ret: 'Form V', due: { kind: 'monthly', day: 10 }, trigger: '10th of the following month', confidence: 'medium' },
    lwf: { form: 'Form F', due: { kind: 'annual', basis: 'calendar', due: '01-31' }, trigger: 'By 31 January for the previous year', confidence: 'medium' } }),
  ...statePack('AP', { se: 'Andhra Pradesh Shops & Establishments Act', seRegister: 'Register of employment and wages', seRegisterForm: 'Form XXIII', holidays: 'Andhra Pradesh N&F Holidays Act',
    pt: { enrol: 'Form I / II', ret: 'Form V', due: { kind: 'monthly', day: 10 }, trigger: '10th of the following month', confidence: 'medium' },
    lwf: { form: 'Form F', due: { kind: 'annual', basis: 'calendar', due: '01-31' }, trigger: 'By 31 January for the previous year', confidence: 'medium' } }),
  ...statePack('DL', { se: 'Delhi Shops & Establishments Act', seRegister: 'Register of employment', seRegisterForm: 'Form G', holidays: 'Delhi N&F Holidays Act',
    lwf: { form: 'LWF challan', due: HALF_JUL_JAN, trigger: 'June and December contributions, by 15 July and 15 January', confidence: 'medium' } }),
  ...statePack('GJ', { se: 'Gujarat Shops & Establishments Act', seRegister: 'Register of employment and wages', seRegisterForm: 'Form M', holidays: 'Gujarat N&F Holidays Act',
    pt: { enrol: 'Form 1 / 2', ret: 'Form 5', due: { kind: 'monthly', day: 15 }, trigger: '15th of the following month', confidence: 'medium' },
    lwf: { form: 'Form A-1', due: { kind: 'half_yearly', basis: 'calendar', due: ['07-31', '01-31'] }, trigger: 'June and December contributions, by 31 July and 31 January', confidence: 'low' } }),
  ...statePack('WB', { se: 'West Bengal Shops & Establishments Act', seRegister: 'Register of employment and wages', seRegisterForm: 'Form I', holidays: 'West Bengal N&F Holidays Act',
    pt: { enrol: 'Form I / II', ret: 'Form III', due: { kind: 'monthly', day: 21 }, trigger: '21st of the following month', confidence: 'medium' },
    lwf: { form: 'Form D', due: HALF_JUL_JAN, trigger: 'June and December contributions, by 15 July and 15 January', confidence: 'medium' } }),
  ...statePack('KL', { se: 'Kerala Shops & Commercial Establishments Act', seRegister: 'Register of employment and wages', seRegisterForm: 'Form H', holidays: 'Kerala N&F Holidays Act',
    pt: { enrol: 'Local body registration', ret: 'Half-yearly PT', due: { kind: 'half_yearly', basis: 'fy', due: ['08-31', '02-28'] }, trigger: 'Each half-year (local body collects; verify)', confidence: 'low' },
    lwf: { form: 'LWF return', due: { kind: 'monthly', day: 15 }, trigger: '15th of the following month (verify)', confidence: 'low' } }),
  ...statePack('UP', { se: 'Uttar Pradesh Dookan Aur Vanijya Adhishthan Adhiniyam', seRegister: 'Register of employment and wages', seRegisterForm: 'Form E', holidays: 'Uttar Pradesh N&F Holidays Act' }),
  ...statePack('HR', { se: 'Punjab Shops & Commercial Establishments Act (Haryana)', seRegister: 'Register of employment and wages', seRegisterForm: 'Form H', holidays: 'Haryana N&F Holidays Act',
    lwf: { form: 'Form A', due: { kind: 'monthly', day: 15 }, trigger: 'Monthly contribution, by the 15th (verify)', confidence: 'low' } }),
];

/** States without a detailed pack still get S&E, PT and LWF tracked as placeholders when you open an establishment there. */
function placeholders(): StatForm[] {
  return (Object.keys(STATES) as StateCode[]).filter((c) => !STATES[c].detailed).flatMap((code) => {
    const s = STATES[code].name;
    const out: StatForm[] = [
      { id: `${code}-S-01`, name: 'Shops & establishments registration', form: 'Registration', act: `${s} Shops & Establishments law`, jurisdiction: code, cls: 'registration', regime: 'legacy', frequency: 'One-time', due: { kind: 'one_time' }, trigger: 'On opening (verify)', source: 'Company profile', confidence: 'low' },
    ];
    if (STATES[code].pt) out.push({ id: `${code}-PT-02`, name: 'Professional tax return and payment', form: 'PT return', act: `${s} Professional Tax law`, jurisdiction: code, cls: 'challan', regime: 'state_fiscal', frequency: 'Monthly', due: { kind: 'monthly', day: 15 }, trigger: 'Periodic (due date to verify)', source: 'Payroll run', confidence: 'low', needs: ['pt'], render: { report: 'pt_report' }, payroll: true });
    if (STATES[code].lwf) out.push({ id: `${code}-LWF-01`, name: 'Labour welfare fund contribution', form: 'LWF return', act: `${s} Labour Welfare Fund law`, jurisdiction: code, cls: 'challan', regime: 'state_welfare', frequency: 'Periodic', due: { kind: 'annual', basis: 'calendar', due: '01-31' }, trigger: 'Periodic (due date to verify)', source: 'Payroll run', confidence: 'low', needs: ['lwf'], payroll: true });
    return out;
  });
}

/**
 * The obligations most state shops and establishments, minimum wages, contract labour and factory laws share, for
 * every state, as low-confidence entries to verify against the state's current rules. States with a detailed pack
 * keep their own registers and notices.
 */
function stateCommons(): StatForm[] {
  return (Object.keys(STATES) as StateCode[]).flatMap((code) => {
    const st = STATES[code];
    const s = st.name;
    const se = `${s} Shops & Establishments law`;
    const verify = (t: string) => `${t} (verify the state’s current rules)`;
    const base = { jurisdiction: code, confidence: 'low' as const };
    const out: StatForm[] = [];
    if (!st.detailed) out.push(
      { ...base, id: `${code}-S-02`, name: 'Register of employment and wages', form: 'Register', act: se, cls: 'register', regime: 'legacy', frequency: 'Monthly', due: { kind: 'continuous' }, trigger: verify('Each wage period'), source: 'Payroll + attendance' },
      { ...base, id: `${code}-S-03`, name: 'Leave with wages register', form: 'Leave register', act: se, cls: 'register', regime: 'legacy', frequency: 'Ongoing', due: { kind: 'continuous' }, trigger: verify('Continuous'), source: 'Leave' },
      { ...base, id: `${code}-S-04`, name: 'Notice of weekly holiday and working hours', form: 'Display', act: se, cls: 'notice', regime: 'legacy', frequency: 'On change', due: { kind: 'continuous' }, trigger: verify('Displayed at the premises'), source: 'Attendance rules' },
      { ...base, id: `${code}-S-05`, name: 'National & festival holidays list', form: 'Intimation + display', act: `${s} holidays law`, cls: 'notice', regime: 'legacy', frequency: 'Annual', due: { kind: 'event' }, trigger: verify('At the start of each year'), source: 'Holidays' },
      { ...base, id: `${code}-S-07`, name: 'Overtime register', form: 'Register', act: se, cls: 'register', regime: 'legacy', frequency: 'Ongoing', due: { kind: 'continuous' }, trigger: verify('Whenever overtime is worked'), source: 'Attendance' },
    );
    if (!st.detailed && st.pt) out.push(
      { ...base, id: `${code}-PT-01`, name: 'Professional tax registration (employer)', form: 'PT registration', act: `${s} Professional Tax law`, cls: 'registration', regime: 'state_fiscal', frequency: 'One-time', due: { kind: 'one_time' }, trigger: verify('Before deducting professional tax'), source: 'Company profile', needs: ['pt'] },
    );
    if (st.lwf) out.push(
      { ...base, id: `${code}-LWF-02`, name: 'Labour welfare fund registration', form: 'LWF registration', act: `${s} Labour Welfare Fund law`, cls: 'registration', regime: 'state_welfare', frequency: 'One-time', due: { kind: 'one_time' }, trigger: verify('Before the first contribution'), source: 'Company profile', needs: ['lwf'] },
    );
    out.push(
      { ...base, id: `${code}-S-06`, name: 'Shops & establishments: changes and renewal', form: 'Amendment / renewal', act: se, cls: 'registration', regime: 'legacy', frequency: 'Event', due: { kind: 'event' }, trigger: verify('When registered details change, and on renewal where required'), source: 'Company profile' },
      { ...base, id: `${code}-S-09`, name: 'Women working at night: permission and safeguards', form: 'Permission / undertaking', act: se, cls: 'registration', regime: 'legacy', frequency: 'Event', due: { kind: 'event' }, trigger: verify('Before women work late or night shifts'), source: 'Attendance rules' },
      { ...base, id: `${code}-MW-01`, name: 'Minimum rates of wages (display)', form: 'Display', act: `${s} minimum wages notification`, cls: 'notice', regime: 'legacy', frequency: 'On revision', due: { kind: 'continuous' }, trigger: verify('Displayed at the premises; revised with each notification'), source: 'Payroll settings' },
      { ...base, id: `${code}-CL-01`, name: 'Contractor licence', form: 'Licence', act: `${s} contract labour rules`, cls: 'registration', regime: 'legacy', frequency: 'One-time + renewal', due: { kind: 'one_time' }, trigger: verify('Held by each contractor before deploying workers'), source: 'Contractors', needs: ['contract'] },
      { ...base, id: `${code}-F-01`, name: 'Factory registers and annual return under state rules', form: 'Registers + return', act: `${s} factories rules`, cls: 'register', regime: 'legacy', frequency: 'Ongoing', due: { kind: 'continuous' }, trigger: verify('Adult workers register, leave and accident records'), source: 'Attendance', needs: ['factory'] },
    );
    return out;
  });
}

export const STAT_FORMS: StatForm[] = [...central, ...states, ...placeholders(), ...stateCommons()];
export const STAT_FORM_BY_ID = new Map(STAT_FORMS.map((f) => [f.id, f]));

// ─── Due dates ───────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** The first MM-DD strictly after the date (clamped to the month's last day, e.g. 02-30 → 28/29 Feb). */
function nextOccurrence(after: string, mmdd: string): string {
  const [y] = after.split('-').map(Number) as [number];
  const [m, d] = mmdd.split('-').map(Number) as [number, number];
  for (const year of [y, y + 1]) {
    const date = iso(year, m, Math.min(d, lastDay(year, m)));
    if (date > after) return date;
  }
  return iso(y + 1, m, Math.min(d, lastDay(y + 1, m)));
}

export interface Obligation { form: StatForm; periodStart: string; periodEnd: string; due: string; label: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;

/** Every period of the form that ends in [fromYear, toYear], with its due date. */
function periods(form: StatForm, fromYear: number, toYear: number): Obligation[] {
  const r = form.due;
  const out: Obligation[] = [];
  const push = (start: string, end: string, due: string, label: string) => {
    if (form.from && end < form.from) return;
    if (form.until && start > form.until) return;
    out.push({ form, periodStart: start, periodEnd: end, due, label });
  };
  for (let y = fromYear - 1; y <= toYear; y++) {
    if (r.kind === 'monthly') {
      for (let m = 1; m <= 12; m++) {
        const start = iso(y, m, 1);
        const end = iso(y, m, lastDay(y, m));
        let due: string;
        if (r.sameMonth) due = r.day === 'last' ? end : iso(y, m, Math.min(r.day, lastDay(y, m)));
        else if (m === 3 && r.march) due = nextOccurrence(end, r.march);
        else {
          const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
          due = iso(ny, nm, r.day === 'last' ? lastDay(ny, nm) : Math.min(r.day, lastDay(ny, nm)));
        }
        push(start, end, due, monthLabel(y, m));
      }
    } else if (r.kind === 'quarterly') {
      // Financial-year quarters: Apr–Jun (Q1), Jul–Sep, Oct–Dec, Jan–Mar (Q4 of the previous FY).
      const qs: Array<[number, number, number, number]> = [[y, 4, 6, 0], [y, 7, 9, 1], [y, 10, 12, 2], [y + 1, 1, 3, 3]];
      for (const [qy, sm, em, i] of qs) {
        const end = iso(qy, em, lastDay(qy, em));
        const fy = `${y}-${pad((y + 1) % 100)}`;
        push(iso(qy, sm, 1), end, nextOccurrence(end, r.due[i]!), `Q${i + 1} FY ${fy}`);
      }
    } else if (r.kind === 'half_yearly') {
      const halves: Array<[string, string, string]> = r.basis === 'calendar'
        ? [[iso(y, 1, 1), iso(y, 6, 30), `Jan–Jun ${y}`], [iso(y, 7, 1), iso(y, 12, 31), `Jul–Dec ${y}`]]
        : [[iso(y, 4, 1), iso(y, 9, 30), `Apr–Sep ${y}`], [iso(y, 10, 1), iso(y + 1, 3, 31), `Oct ${y}–Mar ${y + 1}`]];
      halves.forEach(([start, end, label], i) => push(start, end, nextOccurrence(end, r.due[i]!), label));
    } else if (r.kind === 'annual') {
      const [start, end, label] = r.basis === 'calendar'
        ? [iso(y, 1, 1), iso(y, 12, 31), `${y}`]
        : [iso(y, 4, 1), iso(y + 1, 3, 31), `FY ${y}-${pad((y + 1) % 100)}`];
      push(start, end, nextOccurrence(end, r.due), label);
    }
  }
  return out;
}

/** Obligations of the given forms falling due between from and to (inclusive), earliest first. */
export function obligationsDue(forms: StatForm[], from: string, to: string): Obligation[] {
  const [fy, ty] = [Number(from.slice(0, 4)), Number(to.slice(0, 4))];
  return forms.flatMap((f) => periods(f, fy - 1, ty)).filter((o) => o.due >= from && o.due <= to)
    .sort((a, b) => a.due.localeCompare(b.due) || a.form.id.localeCompare(b.form.id));
}

/** Obligations whose period ends in the wage month (YYYY-MM): what the Documents tab offers for that period. */
export function obligationsForPeriod(forms: StatForm[], month: string): Obligation[] {
  const y = Number(month.slice(0, 4));
  return forms.flatMap((f) => periods(f, y - 1, y + 1)).filter((o) => o.periodEnd.slice(0, 7) === month)
    .sort((a, b) => a.due.localeCompare(b.due) || a.form.id.localeCompare(b.form.id));
}

export const hasCalendar = (f: StatForm) => f.due.kind === 'monthly' || f.due.kind === 'quarterly' || f.due.kind === 'half_yearly' || f.due.kind === 'annual';

// ─── Applicability ───────────────────────────────────────────────────────────

export interface ScopeFacts {
  headcount: number;
  byState: Partial<Record<StateCode, number>>;
  pfEnabled: boolean;
  pfCode: boolean;
  esiEnabled: boolean;
  esiCode: boolean;
  ptEnabled: boolean;
  tds: boolean;
  /** TDS was deducted from vendor or other non-salary payments (Form 26Q, 16A). */
  vendorTds: boolean;
  contractLabour: boolean;
  factory: boolean;
}

export interface Evaluation { form: StatForm; applies: boolean; reasons: string[] }

/** Whether each form applies, with the reasons (the Engine console shows them). */
export function evaluate(form: StatForm, s: ScopeFacts, today: string): Evaluation {
  const reasons: string[] = [];
  let ok = true;
  const fail = (why: string) => { ok = false; reasons.push(`✗ ${why}`); };
  const pass = (why: string) => reasons.push(`✓ ${why}`);
  const state = form.jurisdiction === 'IN' ? null : form.jurisdiction;
  const count = state ? (s.byState[state] ?? 0) : s.headcount;

  if (state) {
    if (count > 0) pass(`${count} employee${count === 1 ? '' : 's'} at establishments in ${STATES[state].name}`);
    else fail(`no establishment in ${STATES[state].name}`);
  } else if (s.headcount > 0) pass(`${s.headcount} employee${s.headcount === 1 ? '' : 's'} in scope`);
  else fail('no employees in scope');

  if (form.min) (count >= form.min ? pass : fail)(`threshold ${form.min}+ ${state ? 'in the state' : 'employees'} (${count})`);
  if (form.until && today > form.until) fail(`superseded on ${form.until}`);
  for (const n of form.needs ?? []) {
    if (n === 'pf') {
      if (!s.pfEnabled) fail('PF is switched off in payroll settings');
      else if (s.headcount >= 20 || s.pfCode) pass(s.pfCode ? 'PF code on file' : '20+ employees: EPF applies');
      else fail('fewer than 20 employees and no PF code (voluntary coverage not recorded)');
    }
    if (n === 'esi') {
      if (!s.esiEnabled) fail('ESI is switched off in payroll settings');
      else if (s.headcount >= 10 || s.esiCode) pass(s.esiCode ? 'ESI code on file' : '10+ employees: ESI applies');
      else fail('fewer than 10 employees and no ESI code');
    }
    if (n === 'pt') {
      if (!state || !STATES[state].pt) fail('no professional tax in this state');
      else (s.ptEnabled ? pass : fail)(s.ptEnabled ? 'state levies professional tax' : 'PT is switched off in payroll settings');
    }
    if (n === 'lwf') (state && STATES[state].lwf ? pass : fail)(state && STATES[state].lwf ? 'labour welfare fund operative in the state' : 'no labour welfare fund in this state');
    if (n === 'tds') (s.tds ? pass : fail)(s.tds ? 'salaries paid through payroll (TDS on salary)' : 'no payroll yet');
    if (n === 'vendor_tds') (s.vendorTds ? pass : fail)(s.vendorTds ? 'TDS deducted from vendor payments' : 'no TDS deducted from vendor payments yet');
    if (n === 'contract') (s.contractLabour ? pass : fail)(s.contractLabour ? 'contract labour engaged' : 'no contract labour engaged (scope setting)');
    if (n === 'factory') (s.factory ? pass : fail)(s.factory ? 'establishment is a factory' : 'not a factory (scope setting)');
  }
  return { form, applies: ok, reasons };
}

export function applicableForms(s: ScopeFacts, today: string): StatForm[] {
  return STAT_FORMS.filter((f) => evaluate(f, s, today).applies);
}
