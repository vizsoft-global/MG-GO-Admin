import ExcelJS from "exceljs";
import type { DeliveryOrdersReportData } from "./orders-report-utils";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
  size: 11,
};

const ZERO_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF8D7DA" },
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D5DD" } },
  left: { style: "thin", color: { argb: "FFD0D5DD" } },
  bottom: { style: "thin", color: { argb: "FFD0D5DD" } },
  right: { style: "thin", color: { argb: "FFD0D5DD" } },
};

function styleHeaderCell(cell: ExcelJS.Cell) {
  cell.fill = HEADER_FILL;
  cell.font = HEADER_FONT;
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.border = BORDER_THIN;
}

function styleDataCell(cell: ExcelJS.Cell, isZero: boolean) {
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.border = BORDER_THIN;
  if (isZero) {
    cell.fill = ZERO_FILL;
  }
}

export async function buildDeliveryOrdersReportXlsx(
  report: DeliveryOrdersReportData,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Delivery Orders", {
    views: [{ state: "frozen", xSplit: 5, ySplit: 1 }],
  });

  const fixedHeaders = ["Emp ID", "MG ID", "Driver", "Store Name", "Position"];
  const headers = [...fixedHeaders, ...report.dayHeaders];

  sheet.columns = [
    { width: 10 },
    { width: 10 },
    { width: 28 },
    { width: 22 },
    { width: 10 },
    ...report.dayHeaders.map(() => ({ width: 8 })),
  ];

  const headerRow = sheet.addRow(headers);
  headerRow.height = 22;
  headerRow.eachCell((cell) => styleHeaderCell(cell));

  for (const row of report.rows) {
    const values: (string | number)[] = [
      row.empId,
      row.mgId,
      row.driver,
      row.store,
      row.position,
      ...report.days.map((day) => row.counts[day] ?? 0),
    ];
    const dataRow = sheet.addRow(values);
    dataRow.eachCell((cell, colNumber) => {
      const isDayCol = colNumber > fixedHeaders.length;
      const isZero = isDayCol && Number(cell.value) === 0;
      if (colNumber <= fixedHeaders.length) {
        cell.alignment = { vertical: "middle", horizontal: colNumber === 3 || colNumber === 4 ? "left" : "center" };
        cell.border = BORDER_THIN;
      } else {
        styleDataCell(cell, isZero);
      }
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

export function downloadDeliveryOrdersReportXlsx(
  report: DeliveryOrdersReportData,
  buffer: ArrayBuffer,
) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const fromStamp = `${report.from}_${report.fromTime.replace(":", "")}`;
  const toStamp = `${report.to}_${report.toTime.replace(":", "")}`;
  a.download = `delivery-orders-${fromStamp}-${toStamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
