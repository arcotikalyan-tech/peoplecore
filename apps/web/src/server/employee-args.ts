import type { Database } from '@peoplecore/db/types';
import type { ChangeAssignmentInput, CreateEmployeeInput } from '@peoplecore/shared';

type Fns = Database['public']['Functions'];

/** Validated form input → RPC arguments. Undefined optional fields are omitted so DB defaults apply. */
export function toCreateEmployeeArgs(organizationId: string, v: CreateEmployeeInput): Fns['create_employee']['Args'] {
  return {
    p_organization_id: organizationId,
    p_first_name: v.firstName,
    p_employment_type: v.employmentType,
    p_date_of_joining: v.dateOfJoining,
    p_employee_code: v.employeeCode,
    p_middle_name: v.middleName,
    p_last_name: v.lastName,
    p_work_email: v.workEmail,
    p_work_phone: v.workPhone,
    p_probation_end_date: v.probationEndDate,
    p_department_id: v.departmentId,
    p_designation_id: v.designationId,
    p_location_id: v.locationId,
    p_legal_entity_id: v.legalEntityId,
    p_manager_employee_id: v.managerEmployeeId,
  };
}

export function toChangeAssignmentArgs(v: ChangeAssignmentInput): Fns['change_employee_assignment']['Args'] {
  return {
    p_employee_id: v.employeeId,
    p_effective_from: v.effectiveFrom,
    p_change_reason: v.changeReason,
    p_department_id: v.departmentId,
    p_designation_id: v.designationId,
    p_location_id: v.locationId,
    p_manager_employee_id: v.managerEmployeeId,
    p_notes: v.notes,
    p_employment_type: v.employmentType,
  };
}
