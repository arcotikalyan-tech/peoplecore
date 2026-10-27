/** PostgREST returns at most this many rows per request (supabase/config.toml max_rows). */
export const PAGE = 1000;

/** The most pages requested at once, so one big list can't take the whole connection pool. */
export const MAX_PARALLEL = 8;

/**
 * Every row of a query, a page at a time, for lists and figures that must be complete (an organization can have more
 * than 1,000 people, punches in a week, applications). `page` builds the query for rows from..to (use .range, with an
 * order that is stable, such as one ending in id). Small results take one request, as before.
 *
 * Pages after the first are requested in rounds that double (2, 4, then 8 at a time): each round is one trip to the
 * database, so 50,000 rows take about 9 trips instead of 50, and a list just past a page costs at most one extra.
 */
export async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>,
): Promise<{ data: T[]; error: null } | { data: null; error: { code?: string; message: string } }> {
  const rows: T[] = [];
  let next = 0;
  for (let batch = 1; ; batch = Math.min(batch * 2, MAX_PARALLEL)) {
    const starts = Array.from({ length: batch }, (_, i) => next + i * PAGE);
    const results = await Promise.all(starts.map((from) => page(from, from + PAGE - 1)));
    for (const { data, error } of results) {
      if (error) return { data: null, error };
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) return { data: rows, error: null };
    }
    next += batch * PAGE;
  }
}
