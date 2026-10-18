import type { Database } from '@peoplecore/db/types';

export type GrievanceCategory = Database['public']['Enums']['grievance_category'];
export type GrievanceStatus = Database['public']['Enums']['grievance_status'];

export const CATEGORY_LABEL: Record<GrievanceCategory, string> = {
  posh: 'Sexual harassment (POSH)',
  discrimination: 'Discrimination',
  bullying: 'Bullying or harassment',
  conduct: 'Conduct of a colleague or manager',
  pay: 'Pay or benefits',
  safety: 'Health and safety',
  ethics: 'Fraud or ethics',
  other: 'Something else',
};

export const STATUS_LABEL: Record<GrievanceStatus, string> = {
  submitted: 'Submitted',
  in_review: 'In review',
  investigating: 'Investigating',
  resolved: 'Resolved',
  closed: 'Closed',
  withdrawn: 'Withdrawn',
};

export const STATUS_TONE: Record<GrievanceStatus, 'neutral' | 'primary' | 'success' | 'warning'> = {
  submitted: 'warning',
  in_review: 'primary',
  investigating: 'primary',
  resolved: 'success',
  closed: 'neutral',
  withdrawn: 'neutral',
};

export const OPEN_STATUSES: GrievanceStatus[] = ['submitted', 'in_review', 'investigating'];
