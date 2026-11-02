/**
 * The comparison caps must cover the month the report is for.
 *
 * This is a source-level guard on purpose: the caps live in a Cloud Function
 * that the page cannot import, and the failure they cause is silent from the
 * client's side — a capped scan answers `scan_cap_exceeded`, so October 2026
 * came back with nothing and read as "this month has no orders".
 *
 * Measured on production on 2026-11-02:
 *   order_recon_rows  2026-10 = 85,878   (2026-09 = 4,106)
 *   deliveries        2026-10 = 175,584  (2026-09 = 130,741)
 *
 * The row ceiling was 50,000, which is below a single month of AM rows, so the
 * previous-month chip failed for every month with more than ~17 days of uploads.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, "..", "..", "..", "functions", "src", "rpcs", "recon-reports.ts"),
  "utf8",
);

function constant(name: string): number {
  const match = new RegExp(`const ${name} = ([0-9_]+);`).exec(source);
  assert.ok(match, `${name} is not declared in recon-reports.ts`);
  return Number(match[1].replace(/_/g, ""));
}

/** The largest single month actually uploaded, measured on production. */
const OCTOBER_2026 = {
  reconRows: 85_878,
  deliveries: 175_584,
};

test("the AM row scan covers a real month of uploads", () => {
  const cap = constant("RECON_ROW_SCAN_CAP");
  assert.ok(
    cap > OCTOBER_2026.reconRows,
    `RECON_ROW_SCAN_CAP is ${cap}, below the ${OCTOBER_2026.reconRows} rows October 2026 holds`,
  );
});

test("the delivery scan covers a real month of orders", () => {
  const cap = constant("RECON_DELIVERY_SCAN_CAP");
  assert.ok(
    cap > OCTOBER_2026.deliveries,
    `RECON_DELIVERY_SCAN_CAP is ${cap}, below the ${OCTOBER_2026.deliveries} deliveries October 2026 holds`,
  );
});

test("the row scan no longer pulls whole documents", () => {
  // An 85k-row month of full documents is what pushes the callable toward the
  // scan lane's timeout; the query must ask for the columns it reads.
  const scan = /collection\(COLLECTIONS\.orderReconRows\)[\s\S]*?\.limit\(RECON_ROW_SCAN_CAP \+ 1\)/.exec(
    source,
  );
  assert.ok(scan, "the AM row scan is missing or its limit changed shape");
  assert.match(scan[0], /\.select\(/, "the AM row scan reads whole documents");
});

test("the two heavy scans start together", () => {
  // ~86k AM rows plus ~176k deliveries took the call close to 120s back to back.
  assert.match(
    source,
    /Promise\.all\(\[[\s\S]*orderReconRows[\s\S]*loadDeliveriesByDay\(from, to, RECON_DELIVERY_SCAN_CAP\)/,
    "the AM row scan and the delivery scan are still sequential",
  );
});
