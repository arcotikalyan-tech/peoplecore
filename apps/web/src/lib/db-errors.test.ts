import { describe, expect, it } from 'vitest';
import { toUserMessage } from './db-errors';
import { safeNextPath } from './safe-redirect';

describe('toUserMessage', () => {
  it('maps known unique constraints to field-specific messages', () => {
    expect(toUserMessage({ code: '23505', message: 'duplicate key value violates unique constraint "employees_work_email_uq"' }))
      .toMatch(/work email/);
  });
  it('never echoes raw database messages for unexpected errors', () => {
    expect(toUserMessage({ code: 'XX000', message: 'relation "secret_table" does not exist' })).not.toContain('secret_table');
  });
  it('maps RLS denials to a permission message', () => {
    expect(toUserMessage({ code: '42501' })).toMatch(/permission/);
  });
});

describe('safeNextPath', () => {
  it.each([['/app/demo', '/app/demo'], ['//evil.example', '/app'], ['https://evil.example', '/app'], ['/\\evil', '/app'], [undefined, '/app']])(
    '%s → %s',
    (input, expected) => expect(safeNextPath(input)).toBe(expected),
  );
});
