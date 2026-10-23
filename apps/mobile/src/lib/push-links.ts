/** The phone screens a notification can open. */
export type PushScreen = '/(app)' | '/(app)/inbox' | '/(app)/leave' | '/(app)/payslips';

/**
 * Where tapping a notification takes you: its link names a website page; the phone opens its own screen for that
 * part of the app, and the Inbox (which lists every notification) for anything the phone doesn't have.
 */
export function screenFor(link: unknown): PushScreen {
  const path = typeof link === 'string' ? link.split('?')[0]! : '';
  const first = path.split('/')[1] ?? '';
  if (first === 'leave') return '/(app)/leave';
  if (first === 'payslips') return '/(app)/payslips';
  if (first === 'attendance') return '/(app)';
  return '/(app)/inbox';
}
