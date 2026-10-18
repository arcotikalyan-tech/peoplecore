/**
 * What agents may read, implemented by the caller. Every function runs AS THE ACTOR (the RLS client in the web
 * app), never with service-role privileges, so an agent can only see what the person asking can see.
 */

export interface KnowledgeHit {
  kind: 'article' | 'policy';
  id: string;
  title: string;
  body: string;
  updatedAt: string;
  rank: number;
}

export type AnalyticsScope = 'organization' | 'reporting_line' | 'self';
export type HeadcountGroup = 'department' | 'location' | 'designation' | 'employment_type' | 'everyone';

/** Aggregates only (database functions analytics_*), counted over the rows the actor can see. */
export interface AnalyticsPort {
  scope(): Promise<{ scope: AnalyticsScope; employeesVisible: number; today: string }>;
  headcount(asOf: string | null, groupBy: HeadcountGroup): Promise<Array<{ label: string; headcount: number }>>;
  movements(from: string, to: string): Promise<Array<{ month: string; joiners: number; leavers: number; headcountEnd: number }>>;
  leave(from: string, to: string): Promise<Array<{ leaveType: string; requests: number; days: number; people: number }>>;
  attendance(from: string, to: string): Promise<Array<{ status: string; days: number; people: number; lateDays: number }>>;
  payroll(months: number): Promise<Array<{ month: string; status: string; employees: number; gross: number; deductions: number; net: number; employerCost: number }>>;
  recruitment(): Promise<{ openRequisitions: number; openings: number; applicationsByStage: Record<string, number>; hiredLast90Days: number }>;
  helpdesk(from: string, to: string): Promise<Array<{ status: string; tickets: number; breached: number; medianHoursToResolve: number | null }>>;
  learning(): Promise<Array<{ course: string; assigned: number; completed: number; overdue: number }>>;
}

export interface DataPort {
  org: { id: string; name: string };
  /** Published knowledge-base articles and current policies matching the text, best first. */
  searchKnowledge(query: string): Promise<KnowledgeHit[]>;
  /** For the reporting copilot; absent where no agent needs it (evals of other agents). */
  analytics?: AnalyticsPort;
}
