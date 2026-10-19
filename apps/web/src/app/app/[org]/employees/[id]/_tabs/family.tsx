import { FAMILY_RELATIONSHIP_LABELS } from '@peoplecore/shared';
import { formatDate } from '@/lib/format';
import { familyMembers } from '@/server/profile';
import { addEmergencyContactAction, addFamilyMemberAction, removeEmergencyContactAction, removeProfileRowAction } from '../actions';
import { EmergencyContacts, FamilyForm, RemoveRow, type ContactRow } from '../profile-forms';
import { Empty, Panel, type ProfileProps } from './shared';

/** Family: family members (with dependents) and emergency contacts. */
export async function FamilyTab({ ctx, slug, id, allowed, contacts }: ProfileProps & { contacts: ContactRow[] }) {
  const rows = await familyMembers(ctx.org.id, id);
  const canEdit = allowed('employee.personal.update');
  return (
    <div className="space-y-5">
      <Panel title="Family Members">
        {rows.length === 0 ? <Empty icon="👨‍👩‍👧" title="No family members" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Family members">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
                <tr><th className="px-5 py-2">Name</th><th className="px-3 py-2">Relation</th><th className="px-3 py-2">Date of birth</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Dependent</th><th className="px-3 py-2" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-2 font-medium">{m.name}{m.occupation && <span className="block text-xs font-normal text-muted">{m.occupation}</span>}</td>
                    <td className="px-3 py-2">{FAMILY_RELATIONSHIP_LABELS[m.relationship as keyof typeof FAMILY_RELATIONSHIP_LABELS]}</td>
                    <td className="px-3 py-2">{m.date_of_birth ? formatDate(m.date_of_birth) : '—'}</td>
                    <td className="px-3 py-2">{m.phone ?? '—'}</td>
                    <td className="px-3 py-2">{m.is_dependent ? 'Yes' : 'No'}</td>
                    <td className="px-3 py-2 text-right">{canEdit && <RemoveRow action={removeProfileRowAction.bind(null, slug, id)} kind="family" id={m.id} label={m.name} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && <FamilyForm action={addFamilyMemberAction.bind(null, slug, id)} />}
      </Panel>
      <section aria-label="Emergency Contact" className="lift-soft rounded-2xl border border-line bg-surface">
        <h2 className="px-5 pt-4 text-sm font-bold uppercase tracking-wide">Emergency Contact</h2>
        <EmergencyContacts contacts={contacts} canEdit={canEdit}
          add={addEmergencyContactAction.bind(null, slug, id)} remove={removeEmergencyContactAction.bind(null, slug, id)} />
      </section>
    </div>
  );
}
