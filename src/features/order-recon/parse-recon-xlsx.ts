import ExcelJS from "exceljs";

const MAX_SPAN_DAYS = 93;

const ID_ALIASES = new Set(["id", "employee id", "employee_id", "driver id", "driver_id"]);
const NAME_ALIASES = new Set(["driver name", "name", "rider name"]);
const STORE_ALIASES = new Set(["store name", "store", "restaurant", "restaurant name"]);
const POSITION_ALIASES = new Set(["position"]);

export type ReconMeltRow = {
  employee_id: string;
  employee_name: string;
  store_name: string;
  work_date: string;
  excel_orders: number;
};

export type ParseReconResult =
  | { ok: true; rows: ReconMeltRow[]; from: string; to: string; dateCount: number }
  | { ok: false; error: "invalid_headers" | "no_date_columns" | "range_too_large" };

function normHeader(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseHeaderDate(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, "0");
    const d = String(raw.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const text = String(raw ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function cellNumber(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function cellText(raw: unknown): string {
  if (raw == null) return "";
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw).trim();
}

export function parseReconWorksheet(ws: ExcelJS.Worksheet): ParseReconResult {
  const headerRow = ws.getRow(1);
  const headers: unknown[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cell.value;
  });

  const h0 = normHeader(headers[0]);
  const h1 = normHeader(headers[1]);
  const h2 = normHeader(headers[2]);
  const h3 = normHeader(headers[3]);
  if (
    headers.length < 4 ||
    !ID_ALIASES.has(h0) ||
    !NAME_ALIASES.has(h1) ||
    !STORE_ALIASES.has(h2) ||
    !POSITION_ALIASES.has(h3)
  ) {
    return { ok: false, error: "invalid_headers" };
  }

  const dateCols: { col: number; ymd: string }[] = [];
  for (let i = 4; i < headers.length; i += 1) {
    const raw = headers[i];
    if (raw == null || String(raw).trim() === "") continue;
    const ymd = parseHeaderDate(raw);
    if (!ymd) return { ok: false, error: "invalid_headers" };
    dateCols.push({ col: i, ymd });
  }
  if (dateCols.length === 0) return { ok: false, error: "no_date_columns" };

  const dates = dateCols.map((c) => c.ymd).sort();
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const span =
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
    ) + 1;
  if (span > MAX_SPAN_DAYS) return { ok: false, error: "range_too_large" };

  const rows: ReconMeltRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const employee_id = cellText(row.getCell(1).value);
    const employee_name = cellText(row.getCell(2).value);
    const store_name = cellText(row.getCell(3).value);
    if (!employee_id && !employee_name && !store_name) return;
    for (const col of dateCols) {
      rows.push({
        employee_id,
        employee_name,
        store_name,
        work_date: col.ymd,
        excel_orders: cellNumber(row.getCell(col.col + 1).value),
      });
    }
  });

  return { ok: true, rows, from, to, dateCount: dateCols.length };
}

export async function parseReconXlsx(buffer: ArrayBuffer | Uint8Array): Promise<ParseReconResult> {
  const wb = new ExcelJS.Workbook();
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  await wb.xlsx.load(bytes as never);
  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, error: "invalid_headers" };
  return parseReconWorksheet(ws);
}
