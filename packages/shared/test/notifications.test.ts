import { describe, expect, it } from 'vitest';
import { newestUnread } from '../src/notifications.ts';

const note = (created_at: string, read = false) => ({ created_at, read_at: read ? '2026-11-05T12:00:00+00:00' : null });

describe('how far seeing the list marks notifications read', () => {
  it('reaches the newest unread one, whatever the order, and skips those already read', () => {
    expect(newestUnread([note('2026-11-05T09:00:00+00:00'), note('2026-11-05T11:00:00+00:00'), note('2026-11-05T10:00:00+00:00')])).toBe('2026-11-05T11:00:00+00:00');
    expect(newestUnread([note('2026-11-05T11:00:00+00:00', true), note('2026-11-05T10:00:00+00:00')])).toBe('2026-11-05T10:00:00+00:00');
  });
  it('is nothing when all are read or the list is empty', () => {
    expect(newestUnread([note('2026-11-05T11:00:00+00:00', true)])).toBeNull();
    expect(newestUnread([])).toBeNull();
  });
  it('tells apart two within the same millisecond, as the database does', () => {
    expect(newestUnread([note('2026-11-05T11:00:00.123456+00:00'), note('2026-11-05T11:00:00.123999+00:00'), note('2026-11-05T11:00:00.1234+00:00')])).toBe('2026-11-05T11:00:00.123999+00:00');
  });
});
