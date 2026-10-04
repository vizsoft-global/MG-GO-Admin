/**
 * Pagination for the deliverables CSV export.
 *
 * Kept in its own module, with no Supabase or `server-only` import, so the
 * boundary arithmetic is unit-testable under `node --test` — the same module
 * boundary `orders-report-operational-day.ts` and `delivery-shift-date.ts` use.
 *
 * The one rule that matters here: PostgREST fills a window to exactly its limit
 * whether or not more rows exist, so a page that comes back **exactly** `limit`
 * long is not evidence of the end. The loop must ask once more and stop on the
 * first short page. Treating "full page" as "done" is exactly the bug the
 * previous single `.range(0, 9999)` call had on a 184k-row table: PostgREST
 * returned 1,000 rows, the caller believed it had everything, and the CSV
 * silently ended.
 */

/**
 * Hard ceiling on a single export. This is the point at which the walk stops and
 * reports that the file is partial rather than truncating in silence.
 */
export const DELIVERIES_EXPORT_MAX_ROWS = 50_000;

/** Rows PostgREST will return in one response. */
export const EXPORT_PAGE_SIZE = 1_000;

/**
 * Walks a paged read in `pageSize` windows until a short page proves the window
 * is exhausted, or `maxRows` is reached.
 */
export async function collectExportPages<T>(
  fetchPage: (offset: number, limit: number) => PromiseLike<T[]>,
  maxRows: number = DELIVERIES_EXPORT_MAX_ROWS,
  pageSize: number = EXPORT_PAGE_SIZE,
): Promise<T[]> {
  const collected: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const limit = Math.min(pageSize, maxRows - offset);
    const page = await fetchPage(offset, limit);
    collected.push(...page);
    if (page.length < limit) break;
  }
  return collected;
}
