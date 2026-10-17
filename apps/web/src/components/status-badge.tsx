import { EMPLOYEE_STATUS_LABELS, type EmployeeStatus } from '@peoplecore/shared';
import { Badge } from './ui/surface';

const tones = { pre_joining: 'primary', active: 'success', on_notice: 'warning', exited: 'neutral' } as const;

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <Badge tone={tones[status]}>{EMPLOYEE_STATUS_LABELS[status]}</Badge>;
}
