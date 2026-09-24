import type {
  OrderReconKpi,
  OrderReconRunSummary,
  OrderReconTableRow,
  ReconRowStatus,
} from "./order-recon-types";

export type OrderReconDailyRow = {
  id: string;
  rider_key: string;
  employee_id: string;
  employee_name: string;
  work_date: string;
  excel_orders: number;
  app_orders: number;
  difference: number;
  status: Exclude<ReconRowStatus, "unresolved">;
};

export type OrderReconUnusedRider = {
  id: string;
  employee_id: string;
  employee_name: string;
  excel_orders: number;
  days_with_excel: number;
  app_orders: 0;
};

export type OrderReconViewKpi = {
  compared: number;
  mismatches: number;
  unresolved: number;
  app_only: number;
  not_using_app: number;
};

export type OrderReconViews = {
  daily: OrderReconDailyRow[];
  unused: OrderReconUnusedRider[];
  unusedIds: Set<string>;
  unresolved: OrderReconTableRow[];
  store: OrderReconTableRow[];
  kpi: OrderReconViewKpi;
};

export type OrderReconEmployeeBucket = "in_app" | "blank";

export type OrderReconEmployee = {
  key: string;
  employee_id: string;
  employee_name: string;
  driver_id: string | null;
  bucket: OrderReconEmployeeBucket;
  excel_orders: number;
  app_orders: number;
  difference: number;
  days_in_sheet: number;
  days_matched: number;
  pct: number;
  status: "match" | "mismatch" | "unused" | "unresolved";
};

export type OrderReconRunProgress = {
  id: string;
  file_name: string;
  from_date: string;
  to_date: string;
  created_at: string;
  matched_days: number;
  sheet_days: number;
  pct: number;
  mismatches: number;
  unused: number;
  unresolved: number;
  app_only: number;
};

export function workDateKey(value: string) {
  return String(value).slice(0, 10);
}

export function employeeLabel(name: string, id: string) {
  return name.trim() || id.trim();
}

/** Empty employee_id (fleet app-only rows from older commits) must not collapse. */
export function riderGroupKey(row: OrderReconTableRow) {
  const id = row.employee_id.trim();
  if (id) return id;
  const name = row.employee_name.trim();
  if (name) return `name:${name}`;
  return `row:${row.id}`;
}

export function inUpload(row: OrderReconTableRow) {
  return row.excel_orders > 0 || row.status === "unresolved";
}

export function unresolvedRows(rows: OrderReconTableRow[]) {
  return rows.filter((row) => row.status === "unresolved");
}

export function comparedStoreRows(rows: OrderReconTableRow[]) {
  return rows.filter((row) => row.status !== "unresolved");
}

export function appOnlyRows(rows: OrderReconTableRow[]) {
  return comparedStoreRows(rows).filter((row) => row.excel_orders === 0 && row.app_orders > 0);
}

function dailyStatus(excel: number, app: number): OrderReconDailyRow["status"] {
  if (excel === 0 && app > 0) return "app_only";
  return app === excel ? "match" : "mismatch";
}

function sheetDayStatus(excel: number, app: number): Exclude<ReconRowStatus, "unresolved" | "app_only"> {
  return app === excel ? "match" : "mismatch";
}

export function unusedAppEmployeeIds(rows: OrderReconTableRow[]) {
  const totals = new Map<string, { excel: number; app: number }>();
  for (const row of comparedStoreRows(rows)) {
    if (!inUpload(row)) continue;
    const key = riderGroupKey(row);
    if (key.startsWith("row:")) continue;
    const prev = totals.get(key) ?? { excel: 0, app: 0 };
    prev.excel += row.excel_orders;
    prev.app += row.app_orders;
    totals.set(key, prev);
  }
  const ids = new Set<string>();
  for (const [id, tot] of totals) {
    if (tot.excel > 0 && tot.app === 0) ids.add(id);
  }
  return ids;
}

export function unusedAppRiders(rows: OrderReconTableRow[]): OrderReconUnusedRider[] {
  const unusedIds = unusedAppEmployeeIds(rows);
  const riders = new Map<
    string,
    { employee_id: string; employee_name: string; excel: number; days: Set<string> }
  >();
  for (const row of comparedStoreRows(rows)) {
    const key = riderGroupKey(row);
    if (!unusedIds.has(key)) continue;
    const prev = riders.get(key) ?? {
      employee_id: row.employee_id.trim() || key,
      employee_name: row.employee_name,
      excel: 0,
      days: new Set<string>(),
    };
    prev.employee_name = prev.employee_name || row.employee_name;
    prev.excel += row.excel_orders;
    if (row.excel_orders > 0) prev.days.add(workDateKey(row.work_date));
    riders.set(key, prev);
  }
  return [...riders.values()]
    .map((rider) => ({
      id: rider.employee_id,
      employee_id: rider.employee_id,
      employee_name: rider.employee_name,
      excel_orders: rider.excel,
      days_with_excel: rider.days.size,
      app_orders: 0 as const,
    }))
    .sort((a, b) => a.employee_id.localeCompare(b.employee_id));
}

function rollupRiderDays(
  rows: OrderReconTableRow[],
  opts: { excludeUnused: boolean; uploadOnly: boolean },
): OrderReconDailyRow[] {
  const unusedIds = unusedAppEmployeeIds(rows);
  const groups = new Map<
    string,
    {
      riderKey: string;
      employee_id: string;
      employee_name: string;
      work_date: string;
      excel: number;
      app: number;
    }
  >();
  for (const row of comparedStoreRows(rows)) {
    if (opts.uploadOnly && !inUpload(row)) continue;
    const riderKey = riderGroupKey(row);
    if (opts.excludeUnused && unusedIds.has(riderKey)) continue;
    const work_date = workDateKey(row.work_date);
    const key = `${riderKey}\0${work_date}`;
    const prev = groups.get(key) ?? {
      riderKey,
      employee_id: row.employee_id.trim() || (riderKey.startsWith("row:") ? "" : riderKey.replace(/^name:/, "")),
      employee_name: row.employee_name,
      work_date,
      excel: 0,
      app: 0,
    };
    prev.employee_name = prev.employee_name || row.employee_name;
    prev.excel += row.excel_orders;
    prev.app += row.app_orders;
    groups.set(key, prev);
  }
  return [...groups.values()]
    .map((group) => {
      const difference = group.app - group.excel;
      return {
        id: `${group.riderKey}:${group.work_date}`,
        rider_key: group.riderKey,
        employee_id: group.employee_id,
        employee_name: group.employee_name,
        work_date: group.work_date,
        excel_orders: group.excel,
        app_orders: group.app,
        difference,
        status: dailyStatus(group.excel, group.app),
      };
    })
    .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.employee_id.localeCompare(b.employee_id));
}

export function rollupDaily(rows: OrderReconTableRow[]): OrderReconDailyRow[] {
  return rollupRiderDays(rows, { excludeUnused: true, uploadOnly: true });
}

export function rollupSheetDays(rows: OrderReconTableRow[]): OrderReconDailyRow[] {
  return rollupRiderDays(rows, { excludeUnused: false, uploadOnly: true });
}

export function storeRowsForView(rows: OrderReconTableRow[]) {
  const unusedIds = unusedAppEmployeeIds(rows);
  return comparedStoreRows(rows).filter((row) => inUpload(row) && !unusedIds.has(riderGroupKey(row)));
}

export function buildReconViews(rows: OrderReconTableRow[]): OrderReconViews {
  const unresolved = unresolvedRows(rows);
  const unused = unusedAppRiders(rows);
  const unusedIds = unusedAppEmployeeIds(rows);
  const daily = rollupDaily(rows);
  const store = storeRowsForView(rows);
  return {
    daily,
    unused,
    unusedIds,
    unresolved,
    store,
    kpi: {
      compared: daily.length,
      mismatches: daily.filter((row) => row.status === "mismatch").length,
      unresolved: unresolved.length,
      app_only: appOnlyRows(rows).length,
      not_using_app: unused.length,
    },
  };
}

export function persistReconKpi(rows: OrderReconTableRow[]): OrderReconKpi {
  const views = buildReconViews(rows);
  const sheet = rollupSheetDays(rows);
  return {
    compared: views.kpi.compared,
    mismatches: views.kpi.mismatches,
    unresolved: views.kpi.unresolved,
    app_only: views.kpi.app_only,
    not_using_app: views.kpi.not_using_app,
    matched_days: sheet.filter((row) => row.status === "match").length,
    sheet_days: sheet.length,
  };
}

export function buildRunProgress(run: OrderReconRunSummary): OrderReconRunProgress {
  const kpi = run.kpi;
  const unused = kpi.not_using_app ?? 0;
  const sheetDays = kpi.sheet_days ?? kpi.compared + unused;
  const matchedDays = kpi.matched_days ?? Math.max(0, kpi.compared - kpi.mismatches);
  return {
    id: run.id,
    file_name: run.file_name,
    from_date: run.from_date,
    to_date: run.to_date,
    created_at: run.created_at,
    matched_days: matchedDays,
    sheet_days: sheetDays,
    pct: sheetDays > 0 ? Math.round((matchedDays / sheetDays) * 100) : 0,
    mismatches: kpi.mismatches,
    unused,
    unresolved: kpi.unresolved,
    app_only: kpi.app_only,
  };
}

export function employeeBucket(row: OrderReconTableRow): OrderReconEmployeeBucket {
  if (row.driver_id) return "in_app";
  if (row.status === "unresolved") return "blank";
  if (!row.employee_id.trim()) return "blank";
  return "in_app";
}

export function buildRunEmployees(rows: OrderReconTableRow[]): {
  in_app: OrderReconEmployee[];
  blank: OrderReconEmployee[];
} {
  const unusedIds = unusedAppEmployeeIds(rows);
  const groups = new Map<
    string,
    {
      employee_id: string;
      employee_name: string;
      driver_id: string | null;
      buckets: Set<OrderReconEmployeeBucket>;
      excel: number;
      app: number;
      days: Set<string>;
      matchedDays: Set<string>;
      unresolved: boolean;
      compared: boolean;
    }
  >();
  for (const row of rows) {
    if (!inUpload(row)) continue;
    const key = riderGroupKey(row);
    const prev = groups.get(key) ?? {
      employee_id: row.employee_id.trim() || (key.startsWith("row:") ? "" : key.replace(/^name:/, "")),
      employee_name: row.employee_name,
      driver_id: row.driver_id ?? null,
      buckets: new Set<OrderReconEmployeeBucket>(),
      excel: 0,
      app: 0,
      days: new Set<string>(),
      matchedDays: new Set<string>(),
      unresolved: false,
      compared: false,
    };
    prev.employee_name = prev.employee_name || row.employee_name;
    prev.driver_id = prev.driver_id || row.driver_id || null;
    prev.buckets.add(employeeBucket(row));
    prev.excel += row.excel_orders;
    prev.app += row.app_orders;
    if (row.excel_orders > 0) prev.days.add(workDateKey(row.work_date));
    if (row.status === "unresolved") prev.unresolved = true;
    else prev.compared = true;
    groups.set(key, prev);
  }

  const sheet = rollupSheetDays(rows);
  for (const day of sheet) {
    if (day.status !== "match") continue;
    const group = groups.get(day.rider_key);
    if (group) group.matchedDays.add(day.work_date);
  }

  const employees = [...groups.entries()]
    .map(([key, group]) => {
      const bucket: OrderReconEmployeeBucket = group.buckets.has("in_app") ? "in_app" : "blank";
      const days_in_sheet = group.days.size;
      const days_matched = group.matchedDays.size;
      const status: OrderReconEmployee["status"] = unusedIds.has(key)
        ? "unused"
        : !group.compared && group.unresolved
          ? "unresolved"
          : group.excel === group.app && group.compared
            ? "match"
            : "mismatch";
      return {
        key,
        employee_id: group.employee_id,
        employee_name: group.employee_name,
        driver_id: group.driver_id,
        bucket,
        excel_orders: group.excel,
        app_orders: group.app,
        difference: group.app - group.excel,
        days_in_sheet,
        days_matched,
        pct: days_in_sheet > 0 ? Math.round((days_matched / days_in_sheet) * 100) : 0,
        status,
      };
    })
    .sort((a, b) => a.employee_id.localeCompare(b.employee_id) || a.employee_name.localeCompare(b.employee_name));

  return {
    in_app: employees.filter((row) => row.bucket === "in_app"),
    blank: employees.filter((row) => row.bucket === "blank"),
  };
}

export function dailyForEmployee(rows: OrderReconTableRow[], employeeKey: string): OrderReconDailyRow[] {
  const filtered = rows.filter((row) => inUpload(row) && riderGroupKey(row) === employeeKey);
  const groups = new Map<
    string,
    { work_date: string; employee_id: string; employee_name: string; excel: number; app: number }
  >();
  for (const row of filtered) {
    const work_date = workDateKey(row.work_date);
    const prev = groups.get(work_date) ?? {
      work_date,
      employee_id: row.employee_id.trim(),
      employee_name: row.employee_name,
      excel: 0,
      app: 0,
    };
    prev.employee_name = prev.employee_name || row.employee_name;
    prev.employee_id = prev.employee_id || row.employee_id.trim();
    prev.excel += row.excel_orders;
    prev.app += row.app_orders;
    groups.set(work_date, prev);
  }
  return [...groups.values()]
    .map((group) => {
      const difference = group.app - group.excel;
      return {
        id: `${employeeKey}:${group.work_date}`,
        rider_key: employeeKey,
        employee_id: group.employee_id,
        employee_name: group.employee_name,
        work_date: group.work_date,
        excel_orders: group.excel,
        app_orders: group.app,
        difference,
        status: sheetDayStatus(group.excel, group.app),
      };
    })
    .sort((a, b) => a.work_date.localeCompare(b.work_date));
}

/** Upload-grain excel/app totals must survive a daily rollup (old runs). */
export function dailyPreservesComparedTotals(rows: OrderReconTableRow[]) {
  const views = buildReconViews(rows);
  const compared = comparedStoreRows(rows).filter(inUpload);
  const excel = compared.reduce((sum, row) => sum + row.excel_orders, 0);
  const app = compared.reduce((sum, row) => sum + row.app_orders, 0);
  const rolledExcel =
    views.daily.reduce((sum, row) => sum + row.excel_orders, 0) +
    views.unused.reduce((sum, row) => sum + row.excel_orders, 0);
  const rolledApp = views.daily.reduce((sum, row) => sum + row.app_orders, 0);
  return excel === rolledExcel && app === rolledApp;
}
