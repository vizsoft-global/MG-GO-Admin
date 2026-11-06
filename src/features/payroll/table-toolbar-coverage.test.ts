import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TableFooterExport } from "@/components/app/table-footer-export";
import { HR_COLUMNS, HR_GROUP_ORDER, hrGroupSpans, visibleHrColumns } from "./hr-payroll-columns";

describe("TableFooterExport", () => {
  it("prints the summary before the download button", () => {
    const html = renderToStaticMarkup(
      createElement(TableFooterExport, {
        summary: "Showing 240 of 962 riders · October 2026",
        exportLabel: "Download this table",
        onExport: () => undefined,
      }),
    );
    assert.ok(html.includes("Showing 240 of 962 riders"));
    assert.ok(html.includes("Download this table"));
    assert.ok(
      html.indexOf("data-table-footer") < html.indexOf("data-table-footer-export"),
      "the count must sit before the button",
    );
  });

  it("renders no button when the page has nothing to export", () => {
    const html = renderToStaticMarkup(
      createElement(TableFooterExport, { summary: "Showing 0 of 0 riders" }),
    );
    assert.ok(html.includes("Showing 0 of 0 riders"));
    assert.ok(!html.includes("data-table-footer-export"));
  });
});

describe("HR band row", () => {
  it("prints From Employees once over the identity block", () => {
    const spans = hrGroupSpans(HR_COLUMNS);
    const emp = spans.filter((span) => span.group === "emp");
    assert.equal(emp.length, 1, `one emp band expected, got ${emp.length}`);
    assert.ok(emp[0].count >= 4, "the identity columns are part of that band");
  });

  it("keeps every visible column inside exactly one band", () => {
    const columns = visibleHrColumns(new Set(HR_GROUP_ORDER));
    const spans = hrGroupSpans(columns);
    assert.equal(
      spans.reduce((sum, span) => sum + span.count, 0),
      columns.length,
      "a band count that does not add up clips a column",
    );
  });
});

/**
 * A payroll table may not ship without a way to choose its columns.
 *
 * The list is explicit: adding a new payroll table means adding its path, which is
 * the point — a table that silently lacks the toolbar is what this catches.
 */
const PAYROLL_TABLES = [
  "src/features/payroll/payroll-tab.tsx",
  "src/features/payroll/combined-tab.tsx",
  "src/features/payroll/payroll-attendance-orders-tab.tsx",
  "src/features/payroll/application-attendance-tab.tsx",
  "src/features/payroll/components/hr-payroll/hr-payroll-tab.tsx",
];

describe("payroll tables expose the Columns control", () => {
  for (const path of PAYROLL_TABLES) {
    it(path, () => {
      const source = readFileSync(path, "utf8");
      assert.match(
        source,
        /(AppTableColumnPicker|ColumnOrderMenu|TableToolbar|ColumnsPopover|PayrollColumnsMenu|CombinedColumnsMenu)/,
        `${path} renders a table without a Columns control`,
      );
    });
  }
});
