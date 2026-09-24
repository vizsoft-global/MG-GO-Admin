import ExcelJS from "exceljs";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";

export const RECON_FIXED_HEADERS = ["ID", "Driver Name", "Store Name", "Position"] as const;

export type ReconTemplateColumn = {
  header: string;
  required: boolean;
  example: string;
  notes: string;
};

export function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function reconSampleDates(today = kuwaitTodayYmd()): [string, string, string] {
  return [shiftYmd(today, -2), shiftYmd(today, -1), today];
}

export function reconTemplateColumns(dates: readonly string[] = reconSampleDates()): ReconTemplateColumn[] {
  return [
    {
      header: "ID",
      required: true,
      example: "10421",
      notes: "Employee ID. Also accepts Employee ID / Driver ID.",
    },
    {
      header: "Driver Name",
      required: true,
      example: "Ahmed Ali",
      notes: "Display name. Resolve is by Employee ID. Also accepts Name / Rider Name.",
    },
    {
      header: "Store Name",
      required: true,
      example: "Crystal Tower",
      notes: "Restaurant name or a saved alias. Also accepts Store / Restaurant.",
    },
    {
      header: "Position",
      required: true,
      example: "Rider",
      notes: "Required by the sheet layout. Not used in the compare.",
    },
    ...dates.map((ymd) => ({
      header: ymd,
      required: true,
      example: "12",
      notes: "Kuwait calendar day as YYYY-MM-DD. Cell is that day's Excel order count.",
    })),
  ];
}

export function reconTemplateHeaders(dates: readonly string[] = reconSampleDates()): string[] {
  return [...RECON_FIXED_HEADERS, ...dates];
}

export function reconGuideRows(dates: readonly string[] = reconSampleDates()): Array<Array<string>> {
  return [
    ["Column", "Required", "Example", "Notes"],
    ...reconTemplateColumns(dates).map((col) => [
      col.header,
      col.required ? "Yes" : "No",
      col.example,
      col.notes,
    ]),
    [],
    ["Rules", "", "", ""],
    ["Date span", "", "", "At most 93 calendar days from first date column to last."],
    ["Blank count", "", "", "Empty date cells count as 0."],
    ["Identity", "", "", "Unknown Employee ID or store stays Unresolved and is not sent as unused."],
  ];
}

export function reconSampleDataRows(dates: readonly string[] = reconSampleDates()): Array<Array<string | number>> {
  return [
    reconTemplateHeaders(dates),
    ["10421", "Ahmed Ali", "Crystal Tower", "Rider", 12, 9, 0],
    ["10422", "Sara Nasser", "Crystal Tower", "Rider", 0, 4, 7],
  ];
}

export async function buildOrderReconTemplateBuffer(
  today = kuwaitTodayYmd(),
): Promise<ArrayBuffer> {
  const dates = reconSampleDates(today);
  const wb = new ExcelJS.Workbook();
  const data = wb.addWorksheet("Data");
  for (const row of reconSampleDataRows(dates)) data.addRow(row);
  const guide = wb.addWorksheet("Guide");
  for (const row of reconGuideRows(dates)) guide.addRow(row);
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

export async function downloadOrderReconTemplate(today = kuwaitTodayYmd()) {
  const buffer = await buildOrderReconTemplateBuffer(today);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "order-recon-template.xlsx";
  anchor.click();
  URL.revokeObjectURL(url);
}
