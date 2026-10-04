import assert from "node:assert/strict";
import test from "node:test";

import {
  DELIVERIES_EXPORT_MAX_ROWS,
  EXPORT_PAGE_SIZE,
  collectExportPages,
} from "./export-pagination";

/**
 * The export's whole correctness problem is one boundary: PostgREST fills a
 * window to exactly 1,000 rows whether or not more rows exist, so "page.length
 * === 1000" must mean "ask again", never "stop". The old `.range(0, 9999)`
 * returned exactly 1,000 rows for a 184k-row table and the CSV just ended.
 *
 * `collectExportPages` is the loop, lifted out of `fetchDeliveriesForExport` so
 * this arithmetic can be exercised without a Supabase client.
 */

type Page = { id: number };

/** Builds a paged fetcher over `total` rows and records every window asked for. */
function recorder(total: number) {
  const windows: Array<{ offset: number; limit: number }> = [];
  const all: Page[] = Array.from({ length: total }, (_, i) => ({ id: i }));
  const fetchPage = async (offset: number, limit: number): Promise<Page[]> => {
    windows.push({ offset, limit });
    return all.slice(offset, offset + limit);
  };
  return { fetchPage, windows, all };
}

test("a partial last page ends the walk without a wasted request", async () => {
  const { fetchPage, windows } = recorder(2_500);

  const rows = await collectExportPages<Page>(fetchPage);

  assert.equal(rows.length, 2_500);
  assert.deepEqual(windows, [
    { offset: 0, limit: EXPORT_PAGE_SIZE },
    { offset: 1_000, limit: EXPORT_PAGE_SIZE },
    { offset: 2_000, limit: EXPORT_PAGE_SIZE },
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    Array.from({ length: 2_500 }, (_, i) => i),
  );
});

test("a page that is exactly 1,000 long keeps the walk going", async () => {
  const { fetchPage, windows } = recorder(2_000);

  const rows = await collectExportPages<Page>(fetchPage);

  assert.equal(rows.length, 2_000);
  // Three windows: two full pages plus the empty one that proves the end.
  // Stopping after two full pages would have silently dropped nothing here but
  // is exactly the read that loses rows when the table has 2,001.
  assert.deepEqual(
    windows.map((w) => w.offset),
    [0, 1_000, 2_000],
  );
});

test("stops at the ceiling instead of streaming the whole table", async () => {
  const { fetchPage, windows } = recorder(250_000);

  const rows = await collectExportPages<Page>(fetchPage);

  assert.equal(rows.length, DELIVERIES_EXPORT_MAX_ROWS);
  assert.equal(windows.length, DELIVERIES_EXPORT_MAX_ROWS / EXPORT_PAGE_SIZE);
  assert.deepEqual(windows.at(-1), { offset: 49_000, limit: EXPORT_PAGE_SIZE });
});

test("a ceiling that is not a whole page trims the final window", async () => {
  const { fetchPage, windows } = recorder(250_000);

  const rows = await collectExportPages<Page>(fetchPage, 2_500);

  assert.equal(rows.length, 2_500);
  assert.deepEqual(windows, [
    { offset: 0, limit: 1_000 },
    { offset: 1_000, limit: 1_000 },
    { offset: 2_000, limit: 500 },
  ]);
});

test("an empty table is one request, not a loop", async () => {
  const { fetchPage, windows } = recorder(0);

  const rows = await collectExportPages<Page>(fetchPage);

  assert.deepEqual(rows, []);
  assert.deepEqual(windows, [{ offset: 0, limit: EXPORT_PAGE_SIZE }]);
});
