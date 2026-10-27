/** PostgREST returns at most this many rows per request (supabase/config.toml max_rows). */
export const PAGE = 1000;

/**
 * Every row of a query, a page at a time, for lists and figures that must be complete (an organization can have more
 * than 1,000 people, punches in a week, applications). `page` builds the query for rows from..to (use .range, with an
 * order that is stable, such as one ending in id). Small results take one request, as before.
 */
export async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>,
): Promise<{ data: T[]; error: null } | { data: null; error: { code?: string; message: string } }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: rows, error: null };
  }
}
