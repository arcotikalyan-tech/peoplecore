/** An attendance rule as the rule editor takes it (shared by the server pages and the client editor). */
export interface RuleValues {
  id?: string;
  name: string;
  description: string | null;
  is_default?: boolean;
  effective_from: string | null;
  start_time: string;
  end_time: string;
  break_minutes: number;
  grace_minutes: number;
  early_grace_minutes: number;
  full_day_minutes: number;
  half_day_minutes: number;
  verify_selfie: boolean;
  verify_geofence: boolean;
  verify_ip: boolean;
  auto_clock_in: boolean;
  auto_clock_out: boolean;
  overtime_after_minutes: number | null;
  comp_off_min_minutes: number | null;
  comp_off_auto_approve: boolean;
  deduct_absent: boolean;
  penalties_enabled: boolean;
  late_marks_allowed: number | null;
  late_interval: number;
  late_method: string;
  early_marks_allowed: number | null;
  early_interval: number;
  early_method: string;
  short_marks_allowed: number | null;
  short_interval: number;
  short_method: string;
  penalty_leave_order: string[];
}

/** A rule row from the database as the editor takes it. */
export function ruleValues(r: Omit<RuleValues, 'penalty_leave_order'> & { penalty_leave_order: string[] | null }): RuleValues {
  return { ...r, penalty_leave_order: r.penalty_leave_order ?? [] };
}
