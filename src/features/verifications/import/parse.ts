import type { ImportMappedRow, ImportTargetField } from "../types";
import {
  cleanCell,
  headerSignature,
  loadStoredMapping as loadStoredMappingBase,
  normalizeDateToIso,
  parseSpreadsheetFile,
  saveStoredMapping as saveStoredMappingBase,
  type ParsedSheet,
} from "@/lib/import/spreadsheet";

export type { ParsedSheet };

export {
  cleanCell,
  headerSignature,
  normalizeDateToIso,
  parseSpreadsheetFile,
};

const DATE_HEADER =
  /^\d{1,2}[-/]\w{3,9}$|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

export function isWideDateLayout(headers: string[]): boolean {
  let dateCols = 0;
  for (const h of headers) {
    if (DATE_HEADER.test(cleanCell(h))) dateCols += 1;
  }
  return dateCols >= 3;
}

function parseExcelDateHeader(header: string, defaultYear = 2026): string | null {
  const h = cleanCell(header).toLowerCase();
  const m = h.match(/^(\d{1,2})[-/](\w{3,9})$/);
  if (m) {
    const day = Number(m[1]);
    const monStr = m[2].slice(0, 3);
    const months: Record<string, number> = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };
    const month = months[monStr];
    if (month == null || !Number.isFinite(day)) return null;
    const d = new Date(Date.UTC(defaultYear, month, day));
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export function unpivotWideRows(
  headers: string[],
  rows: string[][],
  mapping: Partial<Record<ImportTargetField, string>>,
  defaultYear = 2026,
): ImportMappedRow[] {
  const staticTargets: ImportTargetField[] = [
    "employee_id",
    "driver_code",
    "restaurant_external_id",
    "restaurant_name",
    "partner_name",
    "notes",
  ];

  const headerIndex = new Map(headers.map((h, i) => [cleanCell(h), i]));
  const dateColumns: { header: string; index: number; iso: string }[] = [];

  headers.forEach((h, i) => {
    const iso = parseExcelDateHeader(h, defaultYear);
    if (iso) dateColumns.push({ header: h, index: i, iso });
  });

  const out: ImportMappedRow[] = [];
  let rowIndex = 0;

  for (const row of rows) {
    const staticVals: Partial<Record<ImportTargetField, string | null>> = {};
    for (const field of staticTargets) {
      const src = mapping[field];
      if (!src) continue;
      const idx = headerIndex.get(cleanCell(src));
      staticVals[field] =
        idx != null ? cleanCell(row[idx]) || null : null;
    }

    for (const col of dateColumns) {
      const raw = row[col.index];
      const count = parseInt(cleanCell(raw), 10);
      if (!Number.isFinite(count) || count <= 0) continue;

      out.push({
        rowIndex: rowIndex++,
        employee_id: staticVals.employee_id ?? null,
        driver_code: staticVals.driver_code ?? null,
        restaurant_external_id: staticVals.restaurant_external_id ?? null,
        restaurant_name: staticVals.restaurant_name ?? null,
        partner_name: staticVals.partner_name ?? null,
        service_date: col.iso,
        reported_count: count,
        notes: staticVals.notes ?? null,
      });
    }
  }

  return out;
}

export function mapRowsFromSheet(
  headers: string[],
  rows: string[][],
  mapping: Partial<Record<ImportTargetField, string>>,
): ImportMappedRow[] {
  const headerIndex = new Map(headers.map((h, i) => [cleanCell(h), i]));

  return rows
    .map((row, rowIndex) => {
      const get = (field: ImportTargetField): string | null => {
        const src = mapping[field];
        if (!src) return null;
        const idx = headerIndex.get(cleanCell(src));
        if (idx == null) return null;
        const v = cleanCell(row[idx]);
        return v || null;
      };

      const countRaw = get("reported_count");
      const reported = countRaw != null ? parseInt(countRaw, 10) : null;

      return {
        rowIndex,
        employee_id: get("employee_id"),
        driver_code: get("driver_code"),
        restaurant_external_id: get("restaurant_external_id"),
        restaurant_name: get("restaurant_name"),
        partner_name: get("partner_name"),
        service_date: normalizeDateToIso(get("service_date")),
        reported_count: Number.isFinite(reported as number) ? reported : null,
        notes: get("notes"),
      };
    })
    .filter(
      (r) =>
        r.employee_id ||
        r.driver_code ||
        r.restaurant_name ||
        r.restaurant_external_id,
    );
}

export function guessColumnMapping(
  headers: string[],
): Partial<Record<ImportTargetField, string>> {
  const lower = headers.map((h) => ({ raw: h, key: cleanCell(h).toLowerCase() }));
  const find = (...needles: string[]) => {
    const hit = lower.find((h) => needles.some((n) => h.key.includes(n)));
    return hit?.raw;
  };

  return {
    employee_id: find("emp id", "emp_id", "employee"),
    driver_code: find("driver id", "driver_code"),
    restaurant_external_id: find("cc", "store code", "merchant"),
    restaurant_name: find("store name", "restaurant"),
    partner_name: find("company", "partner"),
    service_date: find("date", "service date"),
    reported_count: find("count", "deliveries", "orders"),
    notes: find("notes", "remark"),
  };
}

export const MAPPING_STORAGE_PREFIX = "dpd-verification-mapping:";

export function loadStoredMapping(
  signature: string,
): Partial<Record<ImportTargetField, string>> | null {
  return loadStoredMappingBase<ImportTargetField>(
    MAPPING_STORAGE_PREFIX,
    signature,
  );
}

export function saveStoredMapping(
  signature: string,
  mapping: Partial<Record<ImportTargetField, string>>,
) {
  saveStoredMappingBase(MAPPING_STORAGE_PREFIX, signature, mapping);
}
