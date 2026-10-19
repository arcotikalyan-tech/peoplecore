import type { AssetRow } from '@/server/assets';

/** The register's filters: search (tag, name, serial, category, holder), status, category, condition, location. */
export function filterAssets(rows: AssetRow[], sp: Record<string, string | undefined>, holderName: (employeeId: string) => string) {
  const q = (sp.q ?? '').trim().toLowerCase();
  return rows.filter((a) => {
    if (sp.status && a.status !== sp.status) return false;
    if (sp.category && a.category_id !== sp.category) return false;
    if (sp.condition && a.condition !== sp.condition) return false;
    if (sp.location && a.location_id !== sp.location) return false;
    if (q && !`${a.tag} ${a.name} ${a.serial_number ?? ''} ${a.category} ${a.issue ? holderName(a.issue.employee_id) : ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
