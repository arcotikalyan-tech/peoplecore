import type { ActionState } from '@/lib/action-state';
import { Alert } from './ui/surface';

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return <Alert tone={state.ok ? 'success' : 'danger'} title={state.message} />;
}
