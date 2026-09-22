import type { OrderReconTableRow, ReconRowStatus } from "./order-recon-types";

export type OrderReconDailyRow = {
  id: string;
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

export function workDateKey(value: string) {
  return String(value).slice(0, 10);
}

/** Empty employee_id (fleet app-only rows from older commits) must not collapse. */
export function riderGroupKey(row: OrderReconTableRow) {
  const id = row.employee_id.trim();
  if (id) return id;
  const name = row.employee_name.trim();
  if (name) return `name:${name}`;
  return `row:${row.id}`;
}

export function unresolvedRows(rows: OrderReconTableRow[]) {
  return rows.filter((row) => row.status === "unresolved");
}

export function comparedStoreRows(rows: OrderReconTableRow[]) {
  return rows.filter((row) => row.status !== "unresolved");
}

function dailyStatus(excel: number, app: number): OrderReconDailyRow["status"] {
  if (excel === 0 && app > 0) return "app_only";
  return app === excel ? "match" : "mismatch";
}

export function unusedAppEmployeeIds(rows: OrderReconTableRow[]) {
  const totals = new Map<string, { excel: number; app: number }>();
  for (const row of comparedStoreRows(rows)) {
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

export function rollupDaily(rows: OrderReconTableRow[]): OrderReconDailyRow[] {
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
    const riderKey = riderGroupKey(row);
    if (unusedIds.has(riderKey)) continue;
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

export function storeRowsForView(rows: OrderReconTableRow[]) {
  const unusedIds = unusedAppEmployeeIds(rows);
  return comparedStoreRows(rows).filter((row) => !unusedIds.has(riderGroupKey(row)));
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
      app_only: daily.filter((row) => row.status === "app_only").length,
      not_using_app: unused.length,
    },
  };
}

/** Store-grain excel/app totals must survive a daily rollup (old runs). */
export function dailyPreservesComparedTotals(rows: OrderReconTableRow[]) {
  const views = buildReconViews(rows);
  const compared = comparedStoreRows(rows);
  const excel = compared.reduce((sum, row) => sum + row.excel_orders, 0);
  const app = compared.reduce((sum, row) => sum + row.app_orders, 0);
  const rolledExcel =
    views.daily.reduce((sum, row) => sum + row.excel_orders, 0) +
    views.unused.reduce((sum, row) => sum + row.excel_orders, 0);
  const rolledApp = views.daily.reduce((sum, row) => sum + row.app_orders, 0);
  return excel === rolledExcel && app === rolledApp;
}
