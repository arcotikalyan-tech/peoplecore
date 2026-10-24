import { describe, expect, it } from 'vitest';
import { useDatabase } from './setup.ts';

const ctx = useDatabase();

describe('announcement pictures', () => {
  it('sit under the announcement’s own folder; people who can’t manage announcements can’t set one', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = (await tx.query<{ id: string }>(`insert into announcements (organization_id, title, body) values ($1, 'Office move', 'We move on Monday.') returning id`, [f.orgA])).rows[0]!.id;
      const file = '0b9a3c52-1d4e-4f6a-9b8c-7d6e5f4a3b2c';
      await tx.exec('savepoint s1');
      await expect(tx.query('update announcements set image_path = $2 where id = $1', [id, `${f.orgB}/${id}/${file}`])).rejects.toMatchObject({ code: '23514' });
      await tx.exec('rollback to savepoint s1');
      await expect(tx.query('update announcements set image_path = $2 where id = $1', [id, `${f.orgA}/${id}/../x`])).rejects.toMatchObject({ code: '23514' });
      await tx.exec('rollback to savepoint s1');
      await tx.query('update announcements set image_path = $2 where id = $1', [id, `${f.orgA}/${id}/${file}`]);
      expect((await tx.query('select image_path from announcements where id = $1', [id])).rows).toEqual([{ image_path: `${f.orgA}/${id}/${file}` }]);
    });
    await ctx.t.asUser(f.users.icA, async (tx) => {
      const r = await tx.query(`update announcements set image_path = null where organization_id = $1`, [f.orgA]);
      expect(r.affectedRows).toBe(0); // employees read announcements, they don't change them
    });
  });
});
