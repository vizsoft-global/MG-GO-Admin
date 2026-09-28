import { parseMonthKey } from "./payroll-formulas";

const ID_HEADERS = [
  "driver id",
  "driver_id",
  "employee number",
  "employee id",
  "employee_id",
  "am id",
  "am_id",
  "mg id",
  "mg_id",
];
const NAME_HEADERS = ["driver name", "driver_name", "employee name", "name"];
const OFF_HEADERS = ["off days", "off_days", "number of offs", "number of off", "offs"];
const MONTH_HEADERS = ["month (yyyy-mm)", "month", "period", "period_month"];

export type OffStructureSheetRow = {
  index: number;
  driverKey: string;
  name: string;
  offDaysRaw: string;
  monthRaw: string;
};

function normHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function pickCol(header: string[], aliases: string[]): number {
  return header.findIndex((h) => aliases.includes(normHeader(h)));
}

export function parseOffStructureSheet(
  rows: Array<Array<string | number | null | undefined>>,
): { error: string } | { rows: OffStructureSheetRow[] } {
  if (!rows.length) return { error: "empty_sheet" };
  const header = (rows[0] ?? []).map((c) => String(c ?? ""));
  const idCol = pickCol(header, ID_HEADERS);
  const offCol = pickCol(header, OFF_HEADERS);
  if (idCol < 0 || offCol < 0) return { error: "missing_columns" };
  const nameCol = pickCol(header, NAME_HEADERS);
  const monthCol = pickCol(header, MONTH_HEADERS);
  const out: OffStructureSheetRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const line = rows[i] ?? [];
    const driverKey = String(line[idCol] ?? "").trim();
    const offDaysRaw = String(line[offCol] ?? "").trim();
    const name = nameCol >= 0 ? String(line[nameCol] ?? "").trim() : "";
    const monthRaw = monthCol >= 0 ? String(line[monthCol] ?? "").trim() : "";
    if (!driverKey && !offDaysRaw && !name) continue;
    out.push({ index: i + 1, driverKey, name, offDaysRaw, monthRaw });
  }
  if (!out.length) return { error: "no_rows" };
  return { rows: out };
}

export function parseOffDaysCell(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

export type OffStructureRosterEntry = {
  driverId: string;
  name: string;
  employeeId: string | null;
  driverCode: string | null;
  offStructureDays: number;
};

export function resolveOffStructureKey(
  key: string,
  roster: readonly OffStructureRosterEntry[],
): { kind: "ok"; driver: OffStructureRosterEntry } | { kind: "unknown" } | { kind: "ambiguous" } {
  const needle = key.trim().toUpperCase();
  if (!needle) return { kind: "unknown" };
  const hits = roster.filter((r) => {
    const emp = (r.employeeId ?? "").trim().toUpperCase();
    const code = (r.driverCode ?? "").trim().toUpperCase();
    return emp === needle || code === needle;
  });
  if (hits.length === 1) return { kind: "ok", driver: hits[0] };
  if (hits.length > 1) return { kind: "ambiguous" };
  return { kind: "unknown" };
}

export type OffStructurePreviewVerdict =
  | "applied"
  | "no_change"
  | "missing_id"
  | "duplicate"
  | "invalid_off_days"
  | "off_days_exceeds_month"
  | "unknown_id"
  | "ambiguous_id"
  | "month_mismatch";

export type OffStructurePreviewRow = {
  index: number;
  driverKey: string;
  name: string;
  offDays: number | null;
  previousOffDays: number | null;
  driverId: string | null;
  verdict: OffStructurePreviewVerdict;
};

export function previewOffStructureRows(input: {
  rows: readonly OffStructureSheetRow[];
  roster: readonly OffStructureRosterEntry[];
  monthKey: string;
  monthDays: number;
}): OffStructurePreviewRow[] {
  const seen = new Map<string, number>();
  return input.rows.map((row) => {
    const key = row.driverKey.trim();
    if (!key) {
      return {
        index: row.index,
        driverKey: key,
        name: row.name,
        offDays: null,
        previousOffDays: null,
        driverId: null,
        verdict: "missing_id",
      };
    }
    if (row.monthRaw.trim()) {
      const parsed = parseMonthKey(row.monthRaw.trim());
      const normalised = parsed
        ? `${parsed.year}-${String(parsed.month).padStart(2, "0")}`
        : row.monthRaw.trim();
      if (normalised !== input.monthKey) {
        return {
          index: row.index,
          driverKey: key,
          name: row.name,
          offDays: parseOffDaysCell(row.offDaysRaw),
          previousOffDays: null,
          driverId: null,
          verdict: "month_mismatch",
        };
      }
    }
    const dupKey = key.toUpperCase();
    if (seen.has(dupKey)) {
      return {
        index: row.index,
        driverKey: key,
        name: row.name,
        offDays: parseOffDaysCell(row.offDaysRaw),
        previousOffDays: null,
        driverId: null,
        verdict: "duplicate",
      };
    }
    seen.set(dupKey, row.index);
    const offDays = parseOffDaysCell(row.offDaysRaw);
    if (offDays == null) {
      return {
        index: row.index,
        driverKey: key,
        name: row.name,
        offDays: null,
        previousOffDays: null,
        driverId: null,
        verdict: "invalid_off_days",
      };
    }
    if (offDays > input.monthDays) {
      return {
        index: row.index,
        driverKey: key,
        name: row.name,
        offDays,
        previousOffDays: null,
        driverId: null,
        verdict: "off_days_exceeds_month",
      };
    }
    const hit = resolveOffStructureKey(key, input.roster);
    if (hit.kind === "unknown") {
      return {
        index: row.index,
        driverKey: key,
        name: row.name,
        offDays,
        previousOffDays: null,
        driverId: null,
        verdict: "unknown_id",
      };
    }
    if (hit.kind === "ambiguous") {
      return {
        index: row.index,
        driverKey: key,
        name: row.name,
        offDays,
        previousOffDays: null,
        driverId: null,
        verdict: "ambiguous_id",
      };
    }
    return {
      index: row.index,
      driverKey: key,
      name: hit.driver.name,
      offDays,
      previousOffDays: hit.driver.offStructureDays,
      driverId: hit.driver.driverId,
      verdict: offDays === hit.driver.offStructureDays ? "no_change" : "applied",
    };
  });
}

/** Only real Off Structure changes go to the RPC. Default OFF=2 stays implicit. */
export function offStructureRowsToApply(
  rows: readonly OffStructurePreviewRow[],
): Array<{ driverKey: string; offDays: number }> {
  return rows
    .filter(
      (row): row is OffStructurePreviewRow & { offDays: number } =>
        row.verdict === "applied" && row.offDays != null && Boolean(row.driverKey),
    )
    .map((row) => ({ driverKey: row.driverKey, offDays: row.offDays }));
}
