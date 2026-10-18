/** Postgres/PostgREST error → message safe to show users. Never leaks SQL or row data. */

interface DbError {
  code?: string;
  message?: string;
  details?: string | null;
}

const UNIQUE_MESSAGES: Record<string, string> = {
  employees_work_email_uq: 'Another employee already uses this work email.',
  employees_organization_id_employee_code_key: 'This employee code is already in use.',
  departments_organization_id_code_key: 'A department with this code already exists.',
  designations_organization_id_title_key: 'A designation with this title already exists.',
  locations_organization_id_code_key: 'A location with this code already exists.',
  organizations_slug_key: 'That organization URL is already taken.',
  organization_members_organization_id_user_id_key: 'This person is already a member of this organization.',
  assets_organization_id_tag_key: 'Another asset already has this tag.',
  assets_serial_idx: 'Another asset already has this serial number.',
  access_systems_organization_id_name_key: 'A system with this name already exists.',
};

export function toUserMessage(error: DbError): string {
  switch (error.code) {
    case '42501':
      return 'You don’t have permission to do that.';
    case '23505': {
      const hit = Object.keys(UNIQUE_MESSAGES).find((k) => `${error.message} ${error.details ?? ''}`.includes(k));
      return hit ? UNIQUE_MESSAGES[hit]! : 'This record already exists.';
    }
    case '23503':
      return 'One of the selected items no longer exists or belongs to another organization.';
    case '23514':
      return 'Some values are not allowed. Check the form and try again.';
    case '23P01':
      return 'This change overlaps an existing record for the same period.';
    case 'P0002':
      return 'The record was not found.';
    case '22023':
      // Raised by our own RPCs with messages written for users (see migrations).
      return error.message ?? 'Invalid request.';
    default:
      return 'Something went wrong. Please try again; if it keeps happening, contact support.';
  }
}
