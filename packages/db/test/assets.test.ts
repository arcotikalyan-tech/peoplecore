import { describe, expect, it } from 'vitest';
import type { Transaction } from '@electric-sql/pglite';
import { pgError, useDatabase } from './setup.ts';

const ctx = useDatabase();

async function as(tx: Transaction, user: string) {
  await tx.exec('reset role');
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal2' })]);
  await tx.exec('set local role authenticated');
}

async function failure(tx: Transaction, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string }> {
  await tx.exec('savepoint expect_failure');
  try {
    await tx.query(sql, params);
  } catch (err) {
    await tx.exec('rollback to savepoint expect_failure');
    return { code: (err as { code?: string }).code, message: (err as Error).message };
  }
  throw new Error(`expected to fail: ${sql}`);
}

const status = async (tx: Transaction, id: string) =>
  (await tx.query<{ status: string }>('select status from assets where id = $1', [id])).rows[0]?.status;

describe('assets', () => {
  it('HR adds, issues and takes back an asset; the holder confirms receipt; history stays', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const laptop = (await tx.query<{ id: string; tag: string }>(
        `insert into assets (organization_id, name, category, serial_number, tag) values ($1, 'ThinkPad T14', 'Laptop', ' SN-001 ', '') returning id, tag`, [f.orgA])).rows[0]!;
      expect(laptop.tag).toBe('AST-0001');
      await tx.query(`insert into assets (organization_id, name, category, tag) values ($1, 'Pixel 8', 'Phone', 'AST-0002')`, [f.orgA]);
      const third = (await tx.query<{ tag: string }>(`insert into assets (organization_id, name, category, tag) values ($1, 'Dock', 'Accessory', '') returning tag`, [f.orgA])).rows[0]!;
      expect(third.tag).toBe('AST-0003'); // skips the hand-typed AST-0002
      expect((await failure(tx, `insert into assets (organization_id, name, category, serial_number, tag) values ($1, 'Clone', 'Laptop', 'sn-001', '')`, [f.orgA])).code).toBe('23505');
      expect((await failure(tx, `insert into assets (organization_id, name, category, tag, status) values ($1, 'Ghost', 'Laptop', '', 'assigned')`, [f.orgA])).message)
        .toBe('Issue or return the asset to change who has it.');

      expect((await failure(tx, 'select issue_asset($1, $2, $3)', [laptop.id, f.employees.icA, '2020-01-01'])).message).toBe('The return date can’t be in the past.');
      expect((await failure(tx, 'select issue_asset($1, $2)', [laptop.id, f.employees.employeeB])).message).toBe('Choose a current employee.');
      const issue = (await tx.query<{ id: string }>(`select issue_asset($1, $2, null, 'New, sealed box') as id`, [laptop.id, f.employees.icA])).rows[0]!.id;
      expect(await status(tx, laptop.id)).toBe('assigned');
      expect((await failure(tx, 'select issue_asset($1, $2)', [laptop.id, f.employees.peerA])).message).toBe('This asset is already issued. Return it first.');
      expect((await failure(tx, `update assets set status = 'in_stock' where id = $1`, [laptop.id])).message).toBe('Issue or return the asset to change who has it.');

      await as(tx, f.users.icA);
      expect((await tx.query<{ name: string }>('select name from assets')).rows).toEqual([{ name: 'ThinkPad T14' }]);
      expect((await tx.query(`select 1 from notifications where kind = 'asset.issued'`)).rows).toHaveLength(1);
      await tx.query('select acknowledge_asset($1)', [issue]);
      expect((await tx.query('select 1 from asset_assignments where acknowledged_at is not null')).rows).toHaveLength(1);
      expect((await failure(tx, `select return_asset($1)`, [laptop.id])).code).toBe('42501');
      expect((await failure(tx, `insert into assets (organization_id, name, category, tag) values ($1, 'Mine', 'Laptop', '')`, [f.orgA])).code).toBe('42501');

      await as(tx, f.users.peerA); // not the holder
      expect((await tx.query('select 1 from assets')).rows).toHaveLength(0);
      expect((await failure(tx, 'select acknowledge_asset($1)', [issue])).code).toBe('42501');

      await as(tx, f.users.hrA);
      expect((await failure(tx, `select return_asset($1, 'assigned')`, [laptop.id])).message).toBe('Choose where the asset goes: stock, repair, retired or lost.');
      await tx.query(`select return_asset($1, 'in_repair', 'Cracked hinge')`, [laptop.id]);
      expect(await status(tx, laptop.id)).toBe('in_repair');
      expect((await failure(tx, 'select issue_asset($1, $2)', [laptop.id, f.employees.peerA])).message).toBe('Only an asset in stock can be issued.');
      expect((await failure(tx, 'select return_asset($1)', [laptop.id])).message).toBe('This asset isn’t issued to anyone.');
      expect((await failure(tx, 'delete from assets where id = $1', [laptop.id])).code).toBe('23503'); // history: retire instead
      await tx.query(`update assets set status = 'retired' where id = $1`, [laptop.id]);

      await as(tx, f.users.icA); // past holders still see what they had
      expect((await tx.query<{ condition_in: string }>('select condition_in from asset_assignments')).rows).toEqual([{ condition_in: 'Cracked hinge' }]);
      expect((await failure(tx, 'select acknowledge_asset($1)', [issue])).message).toBe('This asset has already been returned.');

      await as(tx, f.users.employeeB);
      expect((await tx.query('select 1 from assets')).rows).toHaveLength(0);
      expect((await failure(tx, 'select issue_asset($1, $2)', [laptop.id, f.employees.employeeB])).code).toBe('42501');
    });
  });

  it('the worker reminds the holder and asset managers once when a loan is overdue', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const id = (await tx.query<{ id: string }>(`insert into assets (organization_id, name, category, tag) values ($1, 'Projector', 'AV', '') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`select issue_asset($1, $2, current_date + 3)`, [id, f.employees.peerA]);
      expect((await failure(tx, 'select worker_asset_returns()')).code).toBe('42501');
      await tx.exec('reset role');
      await tx.exec('set local role service_role');
      expect((await tx.query<{ r: unknown }>('select worker_asset_returns() as r')).rows[0]!.r).toEqual({ reminded: 0 });
      await tx.exec('reset role');
      await tx.query(`update asset_assignments set due_back_on = current_date - 2 where asset_id = $1`, [id]);
      await tx.exec('set local role service_role');
      expect((await tx.query<{ r: unknown }>('select worker_asset_returns() as r')).rows[0]!.r).toEqual({ reminded: 1 });
      expect((await tx.query<{ r: unknown }>('select worker_asset_returns() as r')).rows[0]!.r).toEqual({ reminded: 0 });
      await tx.exec('reset role');
      const told = (await tx.query<{ user_id: string }>(`select user_id from notifications where kind = 'asset.overdue'`)).rows.map((r) => r.user_id);
      expect(told.sort()).toEqual([f.users.ownerA, f.users.hrA, f.users.peerA].sort());
    });
  });
});

describe('system access', () => {
  it('HR or the system owner records and revokes access; employees see their own', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const github = (await tx.query<{ id: string }>(
        `insert into access_systems (organization_id, name, owner_employee_id) values ($1, 'GitHub', $2) returning id`, [f.orgA, f.employees.peerA])).rows[0]!.id;
      const mail = (await tx.query<{ id: string }>(`insert into access_systems (organization_id, name) values ($1, 'Email') returning id`, [f.orgA])).rows[0]!.id;
      await tx.query(`select grant_access($1, $2, 'ishan@example.test')`, [mail, f.employees.icA]);
      expect((await failure(tx, `select grant_access($1, $2, 'ISHAN@example.test')`, [mail, f.employees.icA])).message).toBe('This account is already recorded for them.');
      expect((await failure(tx, `select grant_access($1, $2, '  ')`, [mail, f.employees.icA])).message).toBe('Enter the account name or email.');
      expect((await failure(tx, `insert into access_grants (organization_id, employee_id, system_id, account) values ($1, $2, $3, 'direct')`,
        [f.orgA, f.employees.icA, mail])).code).toBe('42501');

      await as(tx, f.users.peerA); // owns GitHub only
      const gh = (await tx.query<{ id: string }>(`select grant_access($1, $2, 'ishan-dev', 'Maintainer') as id`, [github, f.employees.icA])).rows[0]!.id;
      expect((await tx.query<{ account: string }>('select account from access_grants')).rows).toEqual([{ account: 'ishan-dev' }]);
      expect((await failure(tx, `select grant_access($1, $2, 'pia@example.test')`, [mail, f.employees.peerA])).code).toBe('42501');
      expect((await tx.query(`update access_systems set name = 'GitHub Enterprise' where id = $1`, [github])).affectedRows).toBe(0); // owners keep the register, not the catalog

      await as(tx, f.users.icA);
      expect((await tx.query<{ item: string; detail: string }>('select item, detail from employee_holdings($1)', [f.employees.icA])).rows)
        .toEqual([{ item: 'Email', detail: 'ishan@example.test' }, { item: 'GitHub', detail: 'ishan-dev · Maintainer' }]);
      expect((await failure(tx, 'select revoke_access($1)', [gh])).code).toBe('42501');

      await as(tx, f.users.managerA);
      expect((await tx.query('select 1 from access_grants')).rows).toHaveLength(0);
      expect((await tx.query<{ name: string }>('select name from access_systems order by name')).rows.map((r) => r.name)).toEqual(['Email', 'GitHub']);

      await as(tx, f.users.peerA);
      await tx.query(`select revoke_access($1, 'Moved to the data team')`, [gh]);
      expect((await failure(tx, 'select revoke_access($1)', [gh])).message).toBe('This access has already been revoked.');

      await as(tx, f.users.hrA);
      expect((await tx.query<{ item: string }>('select item from employee_holdings($1)', [f.employees.icA])).rows).toEqual([{ item: 'Email' }]);
      await tx.query('update access_systems set is_active = false where id = $1', [github]);
      expect((await failure(tx, `select grant_access($1, $2, 'again')`, [github, f.employees.icA])).message).toBe('This system is no longer in use.');
      expect((await failure(tx, 'delete from access_systems where id = $1', [github])).code).toBe('23503');

      await as(tx, f.users.employeeB);
      expect((await tx.query('select 1 from access_systems')).rows).toHaveLength(0);
      expect((await failure(tx, `select grant_access($1, $2, 'x')`, [mail, f.employees.employeeB])).code).toBe('42501');
    });
  });

  it('only asset managers configure systems', async () => {
    const { f } = ctx;
    expect(await pgError(ctx.t.asUser(f.users.managerA, (tx) =>
      tx.query(`insert into access_systems (organization_id, name) values ($1, 'VPN')`, [f.orgA])))).toBe('42501');
  });
});

describe('asset suite', () => {
  it('categories are created from a typed name, follow renames, and give each asset a category', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const a = (await tx.query<{ id: string; category_id: string }>(
        `insert into assets (organization_id, name, category, tag) values ($1, 'MacBook Air', ' laptop ', '') returning id, category_id`, [f.orgA])).rows[0]!;
      const b = (await tx.query<{ category: string; category_id: string }>(
        `insert into assets (organization_id, name, category, tag) values ($1, 'ThinkPad', 'LAPTOP', '') returning category, category_id`, [f.orgA])).rows[0]!;
      expect(b.category_id).toBe(a.category_id);
      expect(b.category).toBe('laptop');
      await tx.query(`update asset_categories set name = 'Laptops', useful_life_months = 36 where id = $1`, [a.category_id]);
      expect((await tx.query<{ category: string }>('select distinct category from assets')).rows).toEqual([{ category: 'Laptops' }]);
      expect((await failure(tx, `insert into assets (organization_id, name, category, tag) values ($1, 'X', '', '')`, [f.orgA])).message).toBe('Choose a category.');
      expect((await failure(tx, 'delete from asset_categories where id = $1', [a.category_id])).code).toBe('23503');
      expect((await failure(tx, `insert into assets (organization_id, name, category, tag, condition) values ($1, 'Y', 'Phone', '', 'broken')`, [f.orgA])).code).toBe('23514');

      await as(tx, f.users.icA); // employees read categories, can't change them
      expect((await tx.query('select 1 from asset_categories')).rows).toHaveLength(1);
      expect((await failure(tx, `insert into asset_categories (organization_id, name) values ($1, 'Mine')`, [f.orgA])).code).toBe('42501');
      await as(tx, f.users.employeeB); // another organization
      expect((await tx.query('select 1 from asset_categories')).rows).toHaveLength(0);
    });
  });

  it('employees request assets; asset managers approve, fulfil by issuing, or reject; requesters cancel', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const cat = (await tx.query<{ id: string }>(`insert into asset_categories (organization_id, name) values ($1, 'Monitor') returning id`, [f.orgA])).rows[0]!.id;
      const locked = (await tx.query<{ id: string }>(`insert into asset_categories (organization_id, name, requestable) values ($1, 'Server', false) returning id`, [f.orgA])).rows[0]!.id;
      const screen = (await tx.query<{ id: string }>(`insert into assets (organization_id, name, category_id, tag) values ($1, 'Dell 27"', $2, '') returning id`, [f.orgA, cat])).rows[0]!.id;
      expect((await failure(tx, `select request_asset($1, $2, 'Need it')`, [f.orgA, cat])).code).toBe('42501'); // no employee record

      await as(tx, f.users.icA);
      expect((await failure(tx, `select request_asset($1, $2, 'For the rack')`, [f.orgA, locked])).message).toBe('Choose a category you can request.');
      expect((await failure(tx, `select request_asset($1, $2, ' ')`, [f.orgA, cat])).message).toBe('Say why you need it.');
      const r1 = (await tx.query<{ id: string }>(`select request_asset($1, $2, 'Second screen for design work') as id`, [f.orgA, cat])).rows[0]!.id;
      expect((await failure(tx, `select request_asset($1, $2, 'Another one')`, [f.orgA, cat])).message).toBe('You already have an open request for this category.');
      expect((await failure(tx, 'select decide_asset_request($1, true)', [r1])).code).toBe('42501');
      expect((await failure(tx, `insert into asset_requests (organization_id, employee_id, category_id, reason) values ($1, $2, $3, 'direct')`,
        [f.orgA, f.employees.icA, cat])).code).toBe('42501');

      await as(tx, f.users.peerA);
      expect((await tx.query('select 1 from asset_requests')).rows).toHaveLength(0);

      await as(tx, f.users.hrA);
      expect((await tx.query(`select 1 from notifications where kind = 'asset.requested' and user_id = $1`, [f.users.hrA])).rows).toHaveLength(1);
      expect((await failure(tx, `select decide_asset_request($1, false, '')`, [r1])).message).toBe('Give a reason for rejecting it.');
      expect((await tx.query<{ s: string }>('select decide_asset_request($1, true) as s', [r1])).rows[0]!.s).toBe('approved');
      expect((await failure(tx, 'select decide_asset_request($1, true)', [r1])).message).toBe('This request has already been decided.');
      expect((await tx.query<{ s: string }>(`select decide_asset_request($1, true, 'Here you go', $2) as s`, [r1, screen])).rows[0]!.s).toBe('fulfilled');
      expect(await status(tx, screen)).toBe('assigned');

      await as(tx, f.users.icA);
      expect((await tx.query<{ status: string; asset_id: string }>('select status, asset_id from asset_requests')).rows).toEqual([{ status: 'fulfilled', asset_id: screen }]);
      const r2 = (await tx.query<{ id: string }>(`select request_asset($1, $2, 'One for home too') as id`, [f.orgA, cat])).rows[0]!.id;
      await tx.query('select cancel_asset_request($1)', [r2]);
      expect((await failure(tx, 'select cancel_asset_request($1)', [r2])).message).toBe('Only a pending request can be cancelled.');
      const r3 = (await tx.query<{ id: string }>(`select request_asset($1, $2, 'For the meeting room') as id`, [f.orgA, cat])).rows[0]!.id;

      await as(tx, f.users.hrA);
      expect((await tx.query<{ s: string }>(`select decide_asset_request($1, false, 'None left this quarter') as s`, [r3])).rows[0]!.s).toBe('rejected');
      expect((await failure(tx, 'select decide_asset_request($1, true)', [r3])).message).toBe('This request has already been decided.');
      await as(tx, f.users.icA);
      expect((await tx.query(`select 1 from notifications where kind = 'asset.request.rejected'`)).rows).toHaveLength(1);
      expect((await failure(tx, 'select cancel_asset_request($1)', [r3])).message).toBe('Only a pending request can be cancelled.');
    });
  });

  it('assets go for repair and come back; dues are recorded and settled, through the next payroll run', async () => {
    const { f } = ctx;
    await ctx.t.asUser(f.users.hrA, async (tx) => {
      const phone = (await tx.query<{ id: string }>(`insert into assets (organization_id, name, category, tag) values ($1, 'Pixel 8', 'Phone', '') returning id`, [f.orgA])).rows[0]!.id;
      const issue = (await tx.query<{ id: string }>('select issue_asset($1, $2) as id', [phone, f.employees.icA])).rows[0]!.id;
      expect((await failure(tx, `select send_asset_for_repair($1, 'Cracked screen')`, [phone])).message).toBe('Take the asset back before sending it for repair.');
      await tx.query(`select return_asset($1, 'in_stock', 'Cracked screen')`, [phone]);
      expect((await failure(tx, `select send_asset_for_repair($1, 'x')`, [phone])).message).toBe('Describe the problem.');
      const repair = (await tx.query<{ id: string }>(`select send_asset_for_repair($1, 'Cracked screen', 'Example Repairs', current_date + 7) as id`, [phone])).rows[0]!.id;
      expect(await status(tx, phone)).toBe('in_repair');
      expect((await failure(tx, `select send_asset_for_repair($1, 'Again')`, [phone])).message).toBe('This asset is already out for repair.');
      expect((await failure(tx, `select complete_asset_repair($1, 10, 'lost')`, [repair])).message).toBe('Choose whether it goes back in stock or is retired.');
      await tx.query(`select complete_asset_repair($1, 4500, 'in_stock', 'fair')`, [repair]);
      expect((await tx.query<{ status: string; condition: string }>('select status, condition from assets where id = $1', [phone])).rows[0])
        .toEqual({ status: 'in_stock', condition: 'fair' });
      expect((await failure(tx, 'select complete_asset_repair($1)', [repair])).message).toBe('This repair is already complete.');

      expect((await failure(tx, `select set_asset_recovery($1, 0, 'Screen')`, [issue])).message).toBe('Enter the amount due.');
      await tx.query(`select set_asset_recovery($1, 4500, 'Screen broken while issued')`, [issue]);

      await as(tx, f.users.icA); // the holder sees their dues, can't settle them
      expect((await tx.query<{ recovery_amount: string }>('select recovery_amount from asset_assignments where id = $1', [issue])).rows[0]!.recovery_amount).toBe('4500.00');
      expect((await failure(tx, `select settle_asset_recovery($1, 'waived')`, [issue])).code).toBe('42501');
      expect((await tx.query('select 1 from asset_repairs')).rows).toHaveLength(0);

      await as(tx, f.users.payrollA); // payroll staff don't manage assets
      expect((await failure(tx, `select settle_asset_recovery($1, 'payroll')`, [issue])).code).toBe('42501');
      await as(tx, f.users.hrA);
      await tx.query(`select settle_asset_recovery($1, 'payroll')`, [issue]);
      await as(tx, f.users.payrollA); // payroll sees the deduction among the next run's adjustments
      const adj = (await tx.query<{ code: string; kind: string; amount: string; employee_id: string }>(
        `select code, kind, amount, employee_id from payroll_adjustments where code = 'ASSET_RECOVERY'`)).rows;
      expect(adj).toEqual([{ code: 'ASSET_RECOVERY', kind: 'deduction', amount: '4500.00', employee_id: f.employees.icA }]);
      await as(tx, f.users.hrA);
      expect((await failure(tx, `select settle_asset_recovery($1, 'waived')`, [issue])).message).toBe('There are no pending dues on this asset.');
      expect((await failure(tx, `select set_asset_recovery($1, 100, 'More')`, [issue])).message).toBe('These dues are already settled.');
    });
  });
});
