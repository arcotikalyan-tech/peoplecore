import { describe, expect, it } from 'vitest';
import { allRows, MAX_PARALLEL, PAGE } from './all-rows';

/** A table of n rows served the way PostgREST does: at most PAGE per request. Records each round of requests. */
const table = (n: number) => {
  const calls: Array<[number, number]> = [];
  let inFlight = 0;
  let mostAtOnce = 0;
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    mostAtOnce = Math.max(mostAtOnce, ++inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    const end = Math.min(n, to + 1, from + PAGE);
    return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null };
  };
  return { calls, page, mostAtOnce: () => mostAtOnce };
};

describe('allRows', () => {
  it('reads every row past the 1,000 a request returns, in order', async () => {
    const t = table(2500);
    const r = await allRows(t.page);
    expect(r.data?.length).toBe(2500);
    expect(r.data).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]); // one page, then two at once
  });

  it('takes one request for a small result, and two rounds when it is exactly a page', async () => {
    const small = table(12);
    expect((await allRows(small.page)).data?.length).toBe(12);
    expect(small.calls).toHaveLength(1);
    const exact = table(PAGE);
    expect((await allRows(exact.page)).data?.length).toBe(PAGE);
    expect(exact.calls).toHaveLength(3); // the full page, then a round of two (both empty)
  });

  it('reads a large organization in a few rounds, never more than the limit at once', async () => {
    const t = table(50_000);
    const r = await allRows(t.page);
    expect(r.data?.length).toBe(50_000);
    expect(new Set(r.data).size).toBe(50_000);
    expect(t.mostAtOnce()).toBeLessThanOrEqual(MAX_PARALLEL);
    expect(t.calls.length).toBeLessThan(60); // 51 pages needed, a few extra at the end of the last round
  });

  it('returns the error and no rows when a page fails', async () => {
    const r = await allRows(async (from) => (from === 0 ? { data: Array(PAGE).fill(1), error: null } : { data: null, error: { code: '57014', message: 'timeout' } }));
    expect(r).toEqual({ data: null, error: { code: '57014', message: 'timeout' } });
  });
});
