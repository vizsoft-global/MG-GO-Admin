import { BATCH_CAP } from "./render/esign-batch-cap";

const EMP_HEADERS = new Set([
  "employee id",
  "employee_id",
  "empid",
  "emp id",
  "emp_id",
  "رقم الموظف",
]);
const DESC_HEADERS = new Set(["description", "desc", "note", "الوصف"]);

export type EsignBulkDraftRow = {
  row_index: number;
  employee_id: string;
  description: string;
  field_values: Record<string, string>;
};

export function headerIndex(headers: string[], needles: Set<string>): number {
  return headers.findIndex((h) => needles.has(h.trim().toLowerCase()));
}

export function parseEsignBulkRows(
  headers: string[],
  rows: string[][],
  fieldKeys: string[],
): { rows: EsignBulkDraftRow[]; error?: string } {
  const empIdx = headerIndex(headers, EMP_HEADERS);
  if (empIdx < 0) return { rows: [], error: "missing_employee_id" };
  const descIdx = headerIndex(headers, DESC_HEADERS);
  const fieldIdx = new Map<string, number>();
  for (const key of fieldKeys) {
    const idx = headers.findIndex((h) => h.trim().toLowerCase() === key.toLowerCase());
    if (idx >= 0) fieldIdx.set(key, idx);
  }

  const out: EsignBulkDraftRow[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const cells = rows[i] ?? [];
    const employee_id = (cells[empIdx] ?? "").trim();
    if (!employee_id && cells.every((c) => !c.trim())) continue;
    const field_values: Record<string, string> = {};
    for (const [key, idx] of fieldIdx) {
      field_values[key] = (cells[idx] ?? "").trim();
    }
    out.push({
      row_index: out.length,
      employee_id,
      description: descIdx >= 0 ? (cells[descIdx] ?? "").trim() : "",
      field_values,
    });
  }

  if (out.length > BATCH_CAP) return { rows: [], error: "batch_cap" };
  return { rows: out };
}
