import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * Tables that had no column manager and now render the shared one.
 *
 * The list is explicit, which is the point: a table added later has to be added
 * here, so "no Columns control" cannot reappear silently. Each entry also names
 * how many columns the table declares, because the shared popover is only worth
 * opening on a table wide enough for a hidden column to be missed.
 */
const TABLES_WITH_COLUMNS = [
  "src/features/portal-v2/client-employees-v2.tsx",
  "src/features/portal-v2/clients-v2.tsx",
  "src/features/esign/esign-sent-shell.tsx",
];

/** Tables that already draw their own Columns control must not gain a second one. */
const TABLES_THAT_OWN_IT = [
  "src/features/payroll/payroll-tab.tsx",
  "src/features/payroll/combined-tab.tsx",
  "src/features/payroll/payroll-attendance-orders-tab.tsx",
  "src/features/payroll/application-attendance-tab.tsx",
  "src/features/payroll/components/hr-payroll/hr-payroll-tab.tsx",
  "src/features/drivers/drivers-page-shell.tsx",
];

describe("tables without a column manager now have one", () => {
  for (const path of TABLES_WITH_COLUMNS) {
    it(path, () => {
      const source = readFileSync(path, "utf8");
      assert.match(source, /ColumnsButton/, `${path} has no Columns button`);
      assert.match(source, /useColumnLayout/, `${path} does not read the saved layout`);
      assert.match(
        source,
        /column\.pinned|lockedIds/,
        `${path} does not declare which columns are pinned`,
      );
    });
  }
});

describe("one column picker per table", () => {
  for (const path of TABLES_THAT_OWN_IT) {
    it(`${path} keeps its own`, () => {
      const source = readFileSync(path, "utf8");
      assert.doesNotMatch(
        source,
        /ColumnsButton/,
        `${path} would render two pickers over one table`,
      );
    });
  }
});
