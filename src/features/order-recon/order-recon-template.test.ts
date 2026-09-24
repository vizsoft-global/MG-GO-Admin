import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseReconXlsx } from "./parse-recon-xlsx";
import {
  buildOrderReconTemplateBuffer,
  reconSampleDates,
  reconTemplateHeaders,
  shiftYmd,
} from "./order-recon-template";

describe("order-recon-template", () => {
  it("uses three YYYY-MM-DD date columns ending on the given day", () => {
    assert.deepEqual(reconSampleDates("2026-09-24"), ["2026-09-22", "2026-09-23", "2026-09-24"]);
    assert.deepEqual(reconTemplateHeaders(reconSampleDates("2026-09-24")), [
      "ID",
      "Driver Name",
      "Store Name",
      "Position",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
    ]);
    assert.equal(shiftYmd("2026-01-01", -1), "2025-12-31");
  });

  it("builds a workbook the parser accepts", async () => {
    const buf = await buildOrderReconTemplateBuffer("2026-09-24");
    const parsed = await parseReconXlsx(buf);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.from, "2026-09-22");
    assert.equal(parsed.to, "2026-09-24");
    assert.equal(parsed.dateCount, 3);
    assert.equal(parsed.rows.length, 6);
  });
});
