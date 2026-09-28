import ExcelJS from "exceljs";
import {
  colLetter,
  fileMonthStamp,
  lastDayCol,
  monthLabelEn,
  ridersInBoth,
  ridersNotUsingApp,
  weekdayShort,
  type ComparisonRider,
} from "./order-comparison-model";

const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };
const SUB_FONT: Partial<ExcelJS.Font> = { size: 10, color: { argb: "FF475467" } };
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D5DD" } },
  left: { style: "thin", color: { argb: "FFD0D5DD" } },
  bottom: { style: "thin", color: { argb: "FFD0D5DD" } },
  right: { style: "thin", color: { argb: "FFD0D5DD" } },
};

function styleHeader(row: ExcelJS.Row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = THIN;
  });
}

function utcDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function comparisonWorkbookName(year: number, month: number): string {
  return `MGGO-Order-Comparison-${fileMonthStamp(year, month)}.xlsx`;
}

export function unusedWorkbookName(year: number, month: number): string {
  return `MGGO-Not-Using-the-App-${fileMonthStamp(year, month)}.xlsx`;
}

export function filteredCsvName(year: number, month: number): string {
  return `MGGO-Order-Comparison-${fileMonthStamp(year, month)}-filtered.csv`;
}

export async function buildComparisonWorkbook(
  riders: ComparisonRider[],
  days: string[],
  year: number,
  month: number,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const monthName = monthLabelEn(year, month);
  const lastCol = lastDayCol(days.length);
  const lastAmRow = riders.length + 1;
  const bothDiff = ridersInBoth(riders).filter((r) => r.offDays > 0);
  const unused = ridersNotUsingApp(riders);
  const indexById = new Map(riders.map((r, i) => [r.mgId, i]));

  const byRider = wb.addWorksheet("By Rider", {
    views: [{ state: "frozen", xSplit: 4, ySplit: 4, topLeftCell: "E5" }],
  });
  byRider.columns = [
    { width: 6 },
    { width: 10 },
    { width: 34 },
    { width: 26 },
    { width: 12 },
    { width: 12 },
    { width: 13 },
    { width: 12 },
    { width: 18 },
    { width: 12 },
  ];
  byRider.getCell("A1").value = `By Rider — AM vs MGGO, ${monthName}`;
  byRider.getCell("A1").font = TITLE_FONT;
  byRider.getCell("A2").value =
    "Matched on MG ID only. Sorted by the size of the difference. Difference = AM − MGGO.";
  byRider.getCell("A2").font = SUB_FONT;
  byRider.getRow(4).values = [
    "#",
    "MG ID",
    "Rider Name",
    "Restaurant",
    "AM Orders",
    "MGGO Orders",
    "Difference\n(AM − MGGO)",
    "Difference\n% of AM",
    "Result",
    "Days with a\ndifference",
  ];
  styleHeader(byRider.getRow(4));

  riders.forEach((rider, i) => {
    const excelRow = i + 5;
    const src = i + 2;
    const row = byRider.getRow(excelRow);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = { formula: `'AM Daily'!A${src}` };
    row.getCell(3).value = { formula: `'AM Daily'!B${src}` };
    row.getCell(4).value = rider.restaurant || "—";
    row.getCell(5).value = { formula: `SUM('AM Daily'!C${src}:${lastCol}${src})` };
    row.getCell(6).value = { formula: `SUM('MGGO Daily'!C${src}:${lastCol}${src})` };
    row.getCell(7).value = { formula: `E${excelRow}-F${excelRow}` };
    row.getCell(8).value = { formula: `IF(E${excelRow}=0,"—",G${excelRow}/E${excelRow})` };
    row.getCell(9).value = {
      formula: `IF(AND(E${excelRow}=0,F${excelRow}=0),"No orders",IF(E${excelRow}=F${excelRow},"Match",IF(F${excelRow}=0,"Not using the app",IF(E${excelRow}=0,"MGGO only",IF(E${excelRow}>F${excelRow},"AM higher","MGGO higher")))))`,
    };
    row.getCell(10).value = {
      formula: `SUMPRODUCT(--('AM Daily'!C${src}:${lastCol}${src}<>'MGGO Daily'!C${src}:${lastCol}${src}))`,
    };
  });

  const dailyDiff = wb.addWorksheet("Daily Difference", {
    views: [{ state: "frozen", xSplit: 5, ySplit: 4, topLeftCell: "F5" }],
  });
  dailyDiff.columns = [
    { width: 10 },
    { width: 30 },
    { width: 24 },
    { width: 11 },
    { width: 9 },
    ...days.map(() => ({ width: 5.6 })),
  ];
  dailyDiff.getCell("A1").value = "Daily Difference — riders in both systems";
  dailyDiff.getCell("A1").font = TITLE_FONT;
  dailyDiff.getCell("A2").value =
    'Each day = AM − MGGO. Red = MGGO has fewer orders than AM. Blank = the two systems agree. Riders with orders in one system only are not shown here — see "Not Using the App", and the "MGGO only" rows on "By Rider".';
  dailyDiff.getCell("A2").font = SUB_FONT;
  dailyDiff.getRow(4).values = [
    "MG ID",
    "Rider Name",
    "Restaurant",
    "Month\nDifference",
    "Days\nwith a diff.",
    ...days.map((ymd) => `${ymd.slice(8)}\n${weekdayShort(ymd)}`),
  ];
  styleHeader(dailyDiff.getRow(4));

  bothDiff.forEach((rider, i) => {
    const src = (indexById.get(rider.mgId) ?? 0) + 2;
    const byRow = (indexById.get(rider.mgId) ?? 0) + 5;
    const excelRow = i + 5;
    const row = dailyDiff.getRow(excelRow);
    row.getCell(1).value = { formula: `'AM Daily'!A${src}` };
    row.getCell(2).value = { formula: `'AM Daily'!B${src}` };
    row.getCell(3).value = { formula: `'By Rider'!D${byRow}` };
    row.getCell(4).value = { formula: `'By Rider'!G${byRow}` };
    row.getCell(5).value = { formula: `'By Rider'!J${byRow}` };
    days.forEach((_, d) => {
      const letter = colLetter(3 + d);
      row.getCell(6 + d).value = {
        formula: `'AM Daily'!${letter}${src}-'MGGO Daily'!${letter}${src}`,
      };
    });
  });

  const unusedSheet = wb.addWorksheet("Not Using the App", {
    views: [{ state: "frozen", xSplit: 0, ySplit: 4, topLeftCell: "A5" }],
  });
  unusedSheet.columns = [
    { width: 10 },
    { width: 34 },
    { width: 28 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ];
  unusedSheet.getCell("A1").value = "Not Using the App — orders in AM, none in the app";
  unusedSheet.getCell("A1").font = TITLE_FONT;
  unusedSheet.getCell("A2").value =
    "These riders delivered orders that appear in the AM file but were never recorded in the MGGO app this month.";
  unusedSheet.getCell("A2").font = SUB_FONT;
  unusedSheet.getRow(4).values = [
    "MG ID",
    "Rider Name",
    "Restaurant",
    "AM Orders",
    "Days with\norders",
    "Avg orders\nper day",
  ];
  styleHeader(unusedSheet.getRow(4));
  unused.forEach((rider, i) => {
    const byRow = (indexById.get(rider.mgId) ?? 0) + 5;
    const amRow = (indexById.get(rider.mgId) ?? 0) + 2;
    const excelRow = i + 5;
    const row = unusedSheet.getRow(excelRow);
    row.getCell(1).value = { formula: `'By Rider'!B${byRow}` };
    row.getCell(2).value = { formula: `'By Rider'!C${byRow}` };
    row.getCell(3).value = { formula: `'By Rider'!D${byRow}` };
    row.getCell(4).value = { formula: `'By Rider'!E${byRow}` };
    row.getCell(5).value = { formula: `COUNTIF('AM Daily'!C${amRow}:${lastCol}${amRow},">0")` };
    row.getCell(6).value = { formula: `IFERROR(D${excelRow}/E${excelRow},0)` };
  });

  const totals = wb.addWorksheet("Daily Totals", {
    views: [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2" }],
  });
  totals.columns = [
    { width: 15 },
    { width: 13 },
    { width: 13 },
    { width: 15 },
    { width: 14 },
  ];
  totals.addRow([
    "Date",
    "AM Orders",
    "MGGO Orders",
    "Difference\n(AM − MGGO)",
    "Riders with a\ndifference",
  ]);
  styleHeader(totals.getRow(1));
  days.forEach((_, i) => {
    const letter = colLetter(3 + i);
    const excelRow = i + 2;
    const row = totals.getRow(excelRow);
    row.getCell(1).value = { formula: `'AM Daily'!${letter}1` };
    row.getCell(1).numFmt = "yyyy-mm-dd";
    row.getCell(2).value = { formula: `SUM('AM Daily'!${letter}2:${letter}${lastAmRow})` };
    row.getCell(3).value = { formula: `SUM('MGGO Daily'!${letter}2:${letter}${lastAmRow})` };
    row.getCell(4).value = { formula: `B${excelRow}-C${excelRow}` };
    row.getCell(5).value = {
      formula: `SUMPRODUCT(--('AM Daily'!${letter}2:${letter}${lastAmRow}<>'MGGO Daily'!${letter}2:${letter}${lastAmRow}))`,
    };
  });

  const amDaily = wb.addWorksheet("AM Daily", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1, topLeftCell: "C2" }],
  });
  amDaily.columns = [{ width: 10 }, { width: 34 }, ...days.map(() => ({ width: 7 }))];
  amDaily.addRow(["MG ID", "Rider Name", ...days.map(utcDate)]);
  amDaily.getRow(1).eachCell((cell, col) => {
    if (col >= 3) cell.numFmt = "yyyy-mm-dd";
  });
  for (const rider of riders) {
    amDaily.addRow([Number(rider.mgId) || rider.mgId, rider.name, ...rider.amDays]);
  }

  const mgDaily = wb.addWorksheet("MGGO Daily", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1, topLeftCell: "C2" }],
  });
  mgDaily.columns = [{ width: 10 }, { width: 34 }, ...days.map(() => ({ width: 7 }))];
  mgDaily.addRow(["MG ID", "Rider Name", ...days.map(utcDate)]);
  mgDaily.getRow(1).eachCell((cell, col) => {
    if (col >= 3) cell.numFmt = "yyyy-mm-dd";
  });
  for (const rider of riders) {
    mgDaily.addRow([Number(rider.mgId) || rider.mgId, rider.name, ...rider.mggoDays]);
  }

  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

export async function buildUnusedWorkbook(
  riders: ComparisonRider[],
  year: number,
  month: number,
): Promise<ArrayBuffer> {
  const unused = ridersNotUsingApp(riders);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Not Using the App");
  ws.columns = [
    { width: 10 },
    { width: 34 },
    { width: 28 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
  ];
  ws.addRow(["MG ID", "Rider Name", "Restaurant", "AM Orders", "Days with orders", "Avg per day"]);
  styleHeader(ws.getRow(1));
  for (const rider of unused) {
    const avg = rider.workedDays > 0 ? rider.am / rider.workedDays : 0;
    ws.addRow([rider.mgId, rider.name, rider.restaurant, rider.am, rider.workedDays, Number(avg.toFixed(2))]);
  }
  const totalRow = ws.addRow([
    "",
    `${unused.length} riders`,
    "",
    unused.reduce((s, r) => s + r.am, 0),
    unused.reduce((s, r) => s + r.workedDays, 0),
    "",
  ]);
  totalRow.font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

export function buildFilteredCsv(riders: ComparisonRider[], days: string[]): string {
  const headers = [
    "MG ID",
    "Rider Name",
    "Restaurant",
    "AM Orders",
    "MGGO Orders",
    "Difference",
    "Difference % of AM",
    "Result",
    "Days with a difference",
    ...days.map((ymd) => `AM-MGGO ${ymd}`),
  ];
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const resultLabel: Record<string, string> = {
    match: "Match",
    am_higher: "AM higher",
    mggo_higher: "MGGO higher",
    not_using_app: "Not using the app",
    mggo_only: "MGGO only",
    no_orders: "No orders",
  };
  const lines = [
    headers.map(esc).join(","),
    ...riders.map((r) =>
      [
        r.mgId,
        r.name,
        r.restaurant,
        r.am,
        r.mggo,
        r.diff,
        r.diffPct == null ? "—" : r.diffPct,
        resultLabel[r.result] ?? r.result,
        r.offDays,
        ...r.diffDays,
      ]
        .map(esc)
        .join(","),
    ),
  ];
  return lines.join("\n");
}

export function downloadBuffer(buffer: ArrayBuffer | ExcelJS.Buffer, fileName: string) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadCsvFile(fileName: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
