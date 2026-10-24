import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@peoplecore/db/types';
import type { Log } from './queue.ts';

const BUCKET = 'audit-archive';

/** Where a day's file is stored (the path audit_archives allows). */
export const auditArchivePath = (orgId: string, day: string) => `${orgId}/${day.slice(0, 4)}/${day}.jsonl.gz`;

/** A day's file before compression: one JSON object per event, in id order, each line ending in a newline. */
export const auditArchiveText = (rows: readonly unknown[]) => rows.map((r) => `${JSON.stringify(r)}\n`).join('');

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

/** A day's archive file: the gzipped JSON lines and the SHA-256 of the uncompressed text. */
export function archiveFile(rows: readonly unknown[]): { body: Buffer; sha256: string } {
  const text = auditArchiveText(rows);
  return { body: gzipSync(Buffer.from(text, 'utf8')), sha256: sha256(text) };
}

/**
 * Archives every day that is due (oldest first, up to `limit`): stores the file (never overwriting one; a file left
 * by an earlier attempt is reused only if it holds the same text) and records the day, which extends the chain.
 */
export async function archiveAuditDays(db: SupabaseClient<Database>, log: Log, limit = 50): Promise<{ archived: number; events: number }> {
  const { data: due, error } = await db.rpc('worker_audit_archive_due', { p_limit: limit });
  if (error) throw new Error(error.message);
  let archived = 0;
  let events = 0;
  for (const { organization_id: org, day } of due ?? []) {
    const list: Array<{ id: number }> = [];
    for (;;) { // a page at a time: the API returns at most 1,000 rows per call
      const { data: rows, error: read } = await db.rpc('worker_audit_day', { p_org: org!, p_day: day!, p_after: list.at(-1)?.id ?? 0, p_limit: 1000 });
      if (read) throw new Error(read.message);
      list.push(...(rows ?? []));
      if ((rows ?? []).length < 1000) break;
    }
    const file = archiveFile(list);
    let path: string | null = null;
    if (list.length > 0) {
      path = auditArchivePath(org!, day!);
      const { error: stored } = await db.storage.from(BUCKET).upload(path, file.body, { contentType: 'application/gzip', upsert: false });
      if (stored) {
        const { data: existing } = await db.storage.from(BUCKET).download(path);
        const same = existing ? sha256(gunzipSync(Buffer.from(await existing.arrayBuffer()))) === file.sha256 : false;
        if (!same) throw new Error(`audit archive ${path}: ${stored.message}`);
      }
    }
    const { error: recorded } = await db.rpc('worker_record_audit_archive', {
      p_org: org!, p_day: day!, p_rows: list.length, p_first: list[0]?.id ?? null as unknown as number,
      p_last: list.at(-1)?.id ?? null as unknown as number, p_sha256: file.sha256, p_path: path as unknown as string,
    });
    if (recorded) throw new Error(recorded.message);
    archived += 1;
    events += list.length;
  }
  if (archived) log('audit.archive', { archived, events });
  return { archived, events };
}
