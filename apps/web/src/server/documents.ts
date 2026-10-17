import 'server-only';
import { createClient } from './supabase';

/** Documents the caller may see (RLS: employee.document.read for this employee). Newest first. */
export async function listDocuments(orgId: string, employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('employee_documents')
    .select('id, category, title, file_name, content_type, size_bytes, uploaded_by, created_at')
    .eq('organization_id', orgId)
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`Failed to load documents (${error.code})`);
  return data;
}

export type EmployeeDocument = Awaited<ReturnType<typeof listDocuments>>[number];
