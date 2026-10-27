import { describe, expect, it } from 'vitest';
import { allRows, PAGE } from './all-rows';

/** A table of n rows served the way PostgREST does: at most PAGE per request. */
const table = (n: number) => {
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(n, to + 1, from + PAGE);
    return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null };
  };
  return { calls, page };
};

describe('allRows', () => {
  it('reads every row past the 1,000 a request returns', async () => {
    const t = table(2500);
    const r = await allRows(t.page);
    expect(r.data?.length).toBe(2500);
    expect(r.data?.at(-1)).toBe(2499);
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('takes one request for a small result, and two when it is exactly a page', async () => {
    expect((await allRows(table(12).page)).data?.length).toBe(12);
    const exact = table(PAGE);
    expect((await allRows(exact.page)).data?.length).toBe(PAGE);
    expect(exact.calls).toHaveLength(2);
  });

  it('returns the error and no rows when a page fails', async () => {
    const r = await allRows(async (from) => (from === 0 ? { data: Array(PAGE).fill(1), error: null } : { data: null, error: { code: '57014', message: 'timeout' } }));
    expect(r).toEqual({ data: null, error: { code: '57014', message: 'timeout' } });
  });
});
