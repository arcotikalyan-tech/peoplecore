import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';
import { archiveAuditDays, archiveFile, auditArchivePath } from '../src/audit-archive.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const row = (id: number) => ({ id, organization_id: ORG, occurred_at: `2026-10-24T0${id}:00:00+00:00`, actor_user_id: null, action: 'insert',
  entity_type: 'employees', entity_id: null, changes: { first_name: 'Asha' }, metadata: {} });

/** A stand-in for the database and storage: two days due, the second with events; files kept in a map. */
function fakeDb(files = new Map<string, Buffer>()) {
  const recorded: Array<Record<string, unknown>> = [];
  const days: Record<string, unknown[]> = { '2026-10-23': [], '2026-10-24': [row(1), row(2)], '2026-10-25': Array.from({ length: 2500 }, (_, i) => row(i + 1)) };
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'worker_audit_archive_due') return { data: [{ organization_id: ORG, day: '2026-10-23' }, { organization_id: ORG, day: '2026-10-24' }], error: null };
      if (fn === 'worker_audit_day') {
        const after = args.p_after as number;
        return { data: (days[args.p_day as string] as Array<{ id: number }>).filter((r) => r.id > after).slice(0, args.p_limit as number), error: null };
      }
      if (fn === 'worker_record_audit_archive') { recorded.push(args); return { data: 'chain', error: null }; }
      throw new Error(fn);
    },
    storage: {
      from: () => ({
        upload: async (path: string, body: Buffer) => {
          if (files.has(path)) return { error: { message: 'The resource already exists' } };
          files.set(path, body);
          return { error: null };
        },
        download: async (path: string) => ({ data: files.has(path) ? new Blob([files.get(path)!]) : null }),
      }),
    },
  } as unknown as SupabaseClient<Database>;
  return { db, files, recorded };
}

describe('the audit log’s daily archive', () => {
  it('writes each day with events as gzipped JSON lines, hashing the text; empty days are recorded without a file', async () => {
    const { db, files, recorded } = fakeDb();
    expect(await archiveAuditDays(db, () => undefined)).toEqual({ archived: 2, events: 2 });
    const path = auditArchivePath(ORG, '2026-10-24');
    expect(path).toBe(`${ORG}/2026/2026-10-24.jsonl.gz`);
    const text = gunzipSync(files.get(path)!).toString('utf8');
    expect(text.split('\n')).toEqual([JSON.stringify(row(1)), JSON.stringify(row(2)), '']);
    const empty = createHash('sha256').update('').digest('hex');
    expect(recorded).toEqual([
      { p_org: ORG, p_day: '2026-10-23', p_rows: 0, p_first: null, p_last: null, p_sha256: empty, p_path: null },
      { p_org: ORG, p_day: '2026-10-24', p_rows: 2, p_first: 1, p_last: 2, p_sha256: createHash('sha256').update(text).digest('hex'), p_path: path },
    ]);
  });

  it('reads a busy day a page at a time (the API returns at most 1,000 rows per call)', async () => {
    const { db, recorded } = fakeDb();
    const busy = { ...db, rpc: (fn: string, args: Record<string, unknown>) =>
      fn === 'worker_audit_archive_due' ? Promise.resolve({ data: [{ organization_id: ORG, day: '2026-10-25' }], error: null }) : db.rpc(fn as never, args as never) } as unknown as SupabaseClient<Database>;
    expect(await archiveAuditDays(busy, () => undefined)).toEqual({ archived: 1, events: 2500 });
    expect(recorded[0]).toMatchObject({ p_rows: 2500, p_first: 1, p_last: 2500 });
  });

  it('reuses a file an earlier attempt stored only if it holds the same events; never overwrites a different one', async () => {
    const path = auditArchivePath(ORG, '2026-10-24');
    const same = fakeDb(new Map([[path, archiveFile([row(1), row(2)]).body]]));
    expect((await archiveAuditDays(same.db, () => undefined)).archived).toBe(2);

    const other = fakeDb(new Map([[path, gzipSync(Buffer.from('{"id":9}\n'))]]));
    await expect(archiveAuditDays(other.db, () => undefined)).rejects.toThrow(/already exists/);
    expect(other.recorded.map((r) => r.p_day)).toEqual(['2026-10-23']); // the day with the clash isn't recorded
  });
});
