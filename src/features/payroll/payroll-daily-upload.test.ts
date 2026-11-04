import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseUploadCsv,
  previewUpload,
  resolveUploadColumns,
  uploadTemplateCsv,
  type UploadContext,
  type UploadRosterEntry,
} from "./payroll-daily-upload";

/**
 * The daily upload is the only door that puts a payable figure into a Keeta or
 * Five Guys cell, so its rejections are the contract. Each case below is a way an
 * operator's sheet can be wrong, and the answer must name the row.
 */

const TODAY = "2026-11-03";
const MONTH = "2026-11";

function context(patch: Partial<UploadContext> = {}): UploadContext {
  const roster = new Map<string, UploadRosterEntry>([
    ["1300", { driverId: "drv-keeta", projectKey: "keeta" }],
    ["1485", { driverId: "drv-americana", projectKey: "americana" }],
    ["2000", { driverId: "drv-five", projectKey: "five_guys" }],
  ]);
  return {
    projectKey: "keeta",
    today: TODAY,
    hours: true,
    lookup: (mgId) => roster.get(mgId.trim().toLowerCase()) ?? null,
    ...patch,
  };
}

function csv(rows: readonly string[]): string {
  return ["MG ID,Date,Working hours", ...rows].join("\n");
}

describe("parsing", () => {
  it("reads the header and honours quoted cells", () => {
    const parsed = parseUploadCsv('MG ID,Date,Hours\n1300,2026-11-01,"9,5"\n');
    assert.deepEqual(parsed.header, ["MG ID", "Date", "Hours"]);
    assert.deepEqual(parsed.rows, [["1300", "2026-11-01", "9,5"]]);
  });

  it("finds the value column under any of the sheet's words", () => {
    assert.equal(resolveUploadColumns(["MG ID", "Date", "Orders"]).value, 2);
    assert.equal(resolveUploadColumns(["MG ID", "Date", "Working hours"]).value, 2);
    assert.equal(resolveUploadColumns(["MG ID", "Date", "Hours"]).value, 2);
    assert.equal(resolveUploadColumns(["Driver ID", "Day", "Value"]).mgId, 0);
  });
});

describe("validation", () => {
  it("accepts a clean file and reports the line the sheet shows", () => {
    const preview = previewUpload(
      csv(["1300,2026-11-01,9.5", "1300,2026-11-02,8"]),
      context(),
      { monthPrefix: MONTH },
    );
    assert.equal(preview.rejected.length, 0);
    assert.deepEqual(
      preview.accepted.map((row) => [row.line, row.date, row.value]),
      [
        [2, "2026-11-01", 9.5],
        [3, "2026-11-02", 8],
      ],
    );
  });

  it("refuses another project's rider instead of writing to it", () => {
    const preview = previewUpload(
      csv(["1485,2026-11-01,9"]),
      context(),
      { monthPrefix: MONTH },
    );
    assert.equal(preview.accepted.length, 0);
    assert.equal(preview.rejected[0]?.code, "row_other_project");
    assert.equal(preview.rejected[0]?.line, 2);
  });

  it("refuses an unknown id, a bad date, a future day and an out-of-month day", () => {
    const preview = previewUpload(
      csv([
        "9999,2026-11-01,9",
        "1300,01-11-2026,9",
        "1300,2026-11-09,9",
        "1300,2026-10-31,9",
      ]),
      context(),
      { monthPrefix: MONTH },
    );
    assert.deepEqual(
      preview.rejected.map((row) => row.code),
      ["row_unknown_id", "row_invalid_date", "row_future_date", "row_outside_month"],
    );
  });

  it("refuses a value that is not a number in range", () => {
    const preview = previewUpload(
      csv(["1300,2026-11-01,", "1300,2026-11-01,abc", "1300,2026-11-01,25", "1300,2026-11-01,-1"]),
      context(),
      { monthPrefix: MONTH },
    );
    assert.equal(preview.accepted.length, 0);
    assert.deepEqual(
      preview.rejected.map((row) => row.code),
      ["row_invalid_value", "row_invalid_value", "row_invalid_value", "row_invalid_value"],
    );
  });

  it("allows more than 24 when the project loads orders, not hours", () => {
    const preview = previewUpload(
      csv(["1300,2026-11-01,25"]),
      context({ hours: false, projectKey: "keeta" }),
      { monthPrefix: MONTH },
    );
    // The same row is a legal order count; the cap belongs to the hours projects.
    assert.equal(preview.accepted.length, 1);
    assert.equal(preview.accepted[0]?.value, 25);
  });

  it("refuses the same rider and day twice", () => {
    const preview = previewUpload(
      csv(["1300,2026-11-01,9", "1300,2026-11-01,7"]),
      context(),
      { monthPrefix: MONTH },
    );
    assert.equal(preview.accepted.length, 1);
    assert.equal(preview.rejected[0]?.code, "row_duplicate");
    assert.equal(preview.rejected[0]?.line, 3);
  });

  it("keeps the rows a bad row did not spoil", () => {
    const preview = previewUpload(
      csv(["1300,2026-11-01,9", "9999,2026-11-01,4", "1300,2026-11-02,8"]),
      context(),
      { monthPrefix: MONTH },
    );
    assert.equal(preview.accepted.length, 2);
    assert.equal(preview.rejected.length, 1);
  });
});

describe("template", () => {
  it("prints the header the parser accepts", () => {
    const text = uploadTemplateCsv("Working hours", [{ mgId: "1300", date: "2026-11-01" }]);
    assert.equal(text.split("\n")[0], "MG ID,Date,Working hours");
    assert.equal(text.split("\n")[1], "1300,2026-11-01,");
  });
});
