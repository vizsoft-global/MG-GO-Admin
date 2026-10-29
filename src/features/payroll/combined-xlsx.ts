import ExcelJS from "exceljs";
import {
  combinedColumn,
  combinedDayCellText,
  COMBINED_DAYS_COLUMN_ID,
  type CombinedValueContext,
} from "./combined-columns";
import { payrollDayPaint } from "./payroll-formulas";
import type { PayrollRiderRow } from "./payroll-types";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF27273F" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D5DD" } },
  left: { style: "thin", color: { argb: "FFD0D5DD" } },
  bottom: { style: "thin", color: { argb: "FFD0D5DD" } },
  right: { style: "thin", color: { argb: "FFD0D5DD" } },
};

/** `#RRGGBB` → Excel's `AARRGGBB`. `transparent` paints nothing. */
export function excelArgb(hex: string): string | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  return `FF${match[1]!.toUpperCase()}`;
}

function solid(hex: string): ExcelJS.Fill | undefined {
  const argb = excelArgb(hex);
  if (!argb) return undefined;
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

/** Zone Category band fills, the same three colours the pill uses. */
export const ZONE_CATEGORY_FILL: Record<string, string> = {
  good: "#10b981",
  average: "#f59e0b",
  low: "#ef4444",
  not_set: "#94a3b8",
};

export type CombinedXlsxColumn = { id: string; header: string };

export type CombinedXlsxInput = {
  /** Month key, used in the sheet and file name. */
  fileKey: string;
  /** Pinned trio headers, already translated and renamed. */
  identityHeaders: { amId: string; mgId: string; name: string };
  /** Visible columns in on-screen order. `days` stands for the whole day block. */
  columns: readonly CombinedXlsxColumn[];
  dates: readonly string[];
  /** One header per date, `1-OCT` style. */
  dayHeaders: readonly string[];
  rows: readonly PayrollRiderRow[];
  today: string;
  /** Translated Zone Category words, keyed by the stored band. */
  zoneCategoryLabels: Record<string, string>;
};

export function combinedWorkbookName(fileKey: string): string {
  return `MGGO-combined-payroll-${fileKey}.xlsx`;
}

const INTEGER_FORMAT = new Set(["wd", "ord", "h3", "hd", "ad", "o", "sk", "ac", "aj", "ua", "lh", "lo"]);

/**
 * The Combined Payroll workbook (SOP item 14).
 *
 * It is the screen: the same columns in the same order, the same fills on the
 * day cells, and an Efficiency that is a real percentage so a reader can sort it.
 */
export async function buildCombinedPayrollWorkbook(input: CombinedXlsxInput): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(input.fileKey, {
    views: [{ state: "frozen", xSplit: 3, ySplit: 1, topLeftCell: "D2" }],
  });
  const ctx: CombinedValueContext = { dates: input.dates, today: input.today };

  const headers = [
    input.identityHeaders.amId,
    input.identityHeaders.mgId,
    input.identityHeaders.name,
  ];
  for (const column of input.columns) {
    if (column.id === COMBINED_DAYS_COLUMN_ID) headers.push(...input.dayHeaders);
    else headers.push(column.header);
  }
  ws.addRow(headers);
  ws.columns = headers.map((_, index) => ({ width: index === 2 ? 34 : 12 }));
  const headerRow = ws.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = THIN;
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  for (const row of input.rows) {
    const excelRow = ws.addRow([]);
    let col = 1;
    const put = (value: string | number | null, numFmt?: string) => {
      const target = excelRow.getCell(col);
      target.value = value == null ? "" : value;
      if (numFmt) target.numFmt = numFmt;
      target.border = THIN;
      col += 1;
      return target;
    };

    // MG ID and Driver ID are text: a leading zero must survive the round trip.
    put(row.amId === "—" ? "" : row.amId, "@");
    put(row.mgId === "—" ? "" : row.mgId, "@");
    put(row.name === "—" ? "" : row.name);

    for (const column of input.columns) {
      if (column.id === COMBINED_DAYS_COLUMN_ID) {
        input.dates.forEach((date, dayIndex) => {
          const status = row.days[dayIndex] ?? "blank";
          if (input.today && date > input.today) {
            const future = put("–");
            future.font = { color: { argb: "FF98A2B3" } };
            future.alignment = { horizontal: "center" };
            return;
          }
          const text = combinedDayCellText(row, dayIndex, ctx);
          const hoursDay = status === "work" || status === "actual" || status === "custom";
          const cell = put(hoursDay && text ? Number(text) : text, hoursDay ? "0.0" : undefined);
          const paint = payrollDayPaint(status, row.jobEndDescription);
          const fill = solid(paint.fill);
          if (fill) cell.fill = fill;
          cell.font = { bold: true, color: { argb: excelArgb(paint.text) ?? "FF292A3F" } };
          cell.alignment = { horizontal: "center" };
        });
        continue;
      }

      const meta = combinedColumn(column.id);
      if (!meta) continue;
      const value = meta.value(row, ctx);

      if (column.id === "zcat") {
        const category = String(value ?? "not_set");
        const cell = put(input.zoneCategoryLabels[category] ?? category);
        const fill = solid(ZONE_CATEGORY_FILL[category] ?? ZONE_CATEGORY_FILL.not_set!);
        if (fill) cell.fill = fill;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        continue;
      }

      if (column.id === "eff") {
        const percent = typeof value === "number" ? value : 0;
        // SOP §14: the cell holds the real percent (87.1), never the ratio (0.871)
        // and never text. The mask prints the % sign, so SUM/AVERAGE stay on the
        // same 0–100 scale the column filters use.
        const cell = put(percent, '0.0"%"');
        cell.font = {
          bold: true,
          color: { argb: percent >= 100 ? "FF15803D" : percent < 70 ? "FFB91C1C" : "FF292A3F" },
        };
        continue;
      }

      if (typeof value !== "number") {
        put(value == null || value === "" ? "" : String(value));
        continue;
      }
      const numFmt =
        column.id === "req" || column.id === "tot"
          ? "0.0"
          : column.id === "act"
            ? "0.00"
            : INTEGER_FORMAT.has(column.id)
              ? "0"
              : "General";
      put(value, numFmt);
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

/** Browser download of the workbook above. No DOM work in the builder. */
export async function exportCombinedPayrollXlsx(input: CombinedXlsxInput): Promise<void> {
  const buffer = await buildCombinedPayrollWorkbook(input);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = combinedWorkbookName(input.fileKey);
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
