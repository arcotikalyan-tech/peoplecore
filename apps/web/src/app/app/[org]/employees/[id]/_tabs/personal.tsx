import { GENDER_LABELS, legalName, MARITAL_STATUS_LABELS } from '@peoplecore/shared';
import { EditableSection } from '@/components/editable-section';
import { Card, CardHeader } from '@/components/ui/surface';
import { formatDate } from '@/lib/format';
import { createClient } from '@/server/supabase';
import { saveCustomValuesAction } from '../../../company/actions';
import { CustomValuesForm } from '../../../company/company-forms';
import { savePersonalDetailsAction } from '../actions';
import { AddressesForm, ContactInfoForm, PersonalInfoForm } from '../profile-forms';
import { Fields, type ProfileProps } from './shared';

type Personal = Record<string, unknown> & { updated_at?: string } | null;

const address = (parts: Array<unknown>) => parts.filter((p) => typeof p === 'string' && p).join(', ') || null;
const str = (v: unknown) => (typeof v === 'string' ? v : v === true ? 'yes' : v === false ? 'no' : null);

/** Personal: personal info, contact info and addresses (each edited on its own), then custom fields. */
export async function PersonalTab(p: ProfileProps & { personal: Personal }) {
  const { employee, isSelf, allowed, slug, id, ctx } = p;
  const v = p.personal ?? {};
  const canEdit = allowed('employee.personal.update');
  const key = `${(v.updated_at as string | undefined) ?? 'none'}`;
  const action = savePersonalDetailsAction.bind(null, slug, id);
  const defaults = Object.fromEntries(Object.entries({
    dateOfBirth: v.date_of_birth, gender: v.gender, bloodGroup: v.blood_group, maritalStatus: v.marital_status, isDisabled: v.is_disabled,
    personalEmail: v.personal_email, personalPhone: v.personal_phone, alternatePhone: v.alternate_phone,
    addressLine1: v.address_line1, addressLine2: v.address_line2, city: v.city, stateCode: v.state_code, postalCode: v.postal_code,
    permSameAsCurrent: v.perm_same_as_current, permAddressLine1: v.perm_address_line1, permAddressLine2: v.perm_address_line2,
    permCity: v.perm_city, permStateCode: v.perm_state_code, permPostalCode: v.perm_postal_code,
  }).map(([k, x]) => [k, str(x)]));
  const current = address([v.address_line1, v.address_line2, v.city, v.state_code, v.postal_code]);
  const permanent = v.perm_same_as_current ? (current ? `${current} (same as current)` : 'Same as current')
    : address([v.perm_address_line1, v.perm_address_line2, v.perm_city, v.perm_state_code, v.perm_postal_code]);

  const custom = await (async () => {
    const supabase = await createClient();
    const [fields, values] = await Promise.all([
      supabase.from('employee_custom_fields').select('id, label, field_type, options, required, editable_by_employee').eq('organization_id', ctx.org.id).is('archived_at', null).order('position').order('created_at'),
      supabase.from('employee_custom_values').select('field_id, value').eq('employee_id', id),
    ]);
    return { fields: fields.data ?? [], values: Object.fromEntries((values.data ?? []).map((x) => [x.field_id, x.value])) };
  })();
  const canEditWork = ctx.can('employee.update', 'org');

  return (
    <div className="space-y-5">
      {p.personal !== undefined && allowed('employee.personal.read') ? (
        <>
          <EditableSection key={`pi:${key}`} title="Personal Info" description={isSelf ? 'Visible to you and HR.' : 'Visible to HR and the employee.'} canEdit={canEdit}
            view={<Fields items={[
              { label: 'Name', value: legalName(employee) },
              { label: 'Date of birth', value: v.date_of_birth ? formatDate(v.date_of_birth as string) : null },
              { label: 'Gender', value: v.gender ? GENDER_LABELS[v.gender as keyof typeof GENDER_LABELS] : null },
              { label: 'Blood group', value: v.blood_group as string },
              { label: 'Marital status', value: v.marital_status ? MARITAL_STATUS_LABELS[v.marital_status as keyof typeof MARITAL_STATUS_LABELS] : null },
              { label: 'Is employee disabled', value: v.is_disabled ? 'Yes' : 'No' },
            ]} />}>
            <PersonalInfoForm action={action} defaults={defaults} />
          </EditableSection>
          <EditableSection key={`ci:${key}`} title="Contact Info" canEdit={canEdit}
            view={<Fields items={[
              { label: 'Official email ID', value: employee.work_email },
              { label: 'Personal email ID', value: v.personal_email as string },
              { label: 'Phone number', value: (v.personal_phone as string) ?? employee.work_phone },
              { label: 'Work phone', value: employee.work_phone },
              { label: 'Alternate phone number', value: v.alternate_phone as string },
            ]} />}>
            <ContactInfoForm action={action} defaults={defaults} />
          </EditableSection>
          <EditableSection key={`ad:${key}`} title="Addresses" canEdit={canEdit}
            view={<Fields cols={2} items={[{ label: 'Current address', value: current }, { label: 'Permanent address', value: permanent }]} />}>
            <AddressesForm action={action} defaults={defaults} />
          </EditableSection>
        </>
      ) : (
        <Card>
          <CardHeader title="Contact Info" />
          <Fields items={[{ label: 'Official email ID', value: employee.work_email }, { label: 'Work phone', value: employee.work_phone }]} />
        </Card>
      )}

      {custom.fields.length > 0 && (
        <Card>
          <CardHeader title="Custom fields" description={canEditWork ? 'Defined in Company Profile › Employee Custom Fields.' : undefined} />
          {canEditWork || (isSelf && custom.fields.some((f) => f.editable_by_employee))
            ? <CustomValuesForm action={saveCustomValuesAction.bind(null, slug, id)} fields={custom.fields} values={custom.values} canEditAll={canEditWork} />
            : <Fields items={custom.fields.map((f) => ({ label: f.label, value: custom.values[f.id] ?? null }))} />}
        </Card>
      )}
    </div>
  );
}
