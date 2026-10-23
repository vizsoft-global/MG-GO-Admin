import type { HrImportField } from "./hr-payroll-types";

export type HrImportRosterRow = {
  driverId: string;
  mgId: string;
  driverCode: string;
};

export type HrImportResult = {
  field: HrImportField;
  matched: { driverId: string; mgId: string; amount: number }[];
  unknown: string[];
  ambiguous: string[];
};

const HEADER = /^(mg\s*id|employee\s*id|driver\s*code|driver\s*id|amount)$/i;

function indexBy(rows: readonly HrImportRosterRow[], pick: (row: HrImportRosterRow) => string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const key = pick(row).trim().toLowerCase();
    if (!key) continue;
    const list = map.get(key) ?? [];
    if (!list.includes(row.driverId)) list.push(row.driverId);
    map.set(key, list);
  }
  return map;
}

export function parseHrImport(
  text: string,
  roster: readonly HrImportRosterRow[],
  field: HrImportField,
): HrImportResult {
  const byEmployee = indexBy(roster, (row) => row.mgId);
  const byCode = indexBy(roster, (row) => row.driverCode);
  const idOf = new Map(roster.map((row) => [row.driverId, row.mgId || row.driverCode]));
  const matched = new Map<string, { driverId: string; mgId: string; amount: number }>();
  const unknown: string[] = [];
  const ambiguous: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[,;\t]/).map((part) => part.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;
    const id = parts[0] ?? "";
    const amount = Number(parts[1]);
    if (!id || HEADER.test(id)) continue;
    if (!Number.isFinite(amount) || amount < 0) {
      unknown.push(id);
      continue;
    }
    const employeeHits = byEmployee.get(id.toLowerCase()) ?? [];
    const codeHits = employeeHits.length ? [] : (byCode.get(id.toLowerCase()) ?? []);
    const hits = employeeHits.length ? employeeHits : codeHits;
    if (hits.length === 1) {
      const driverId = hits[0] ?? "";
      matched.set(driverId, { driverId, mgId: idOf.get(driverId) || id, amount });
    } else if (hits.length > 1) {
      ambiguous.push(id);
    } else {
      unknown.push(id);
    }
  }
  return { field, matched: [...matched.values()], unknown, ambiguous };
}
