export type DeliveryOrdersReportRpcRow = {
  driver_id: string;
  driver_code: string;
  employee_id: string;
  full_name: string;
  store_name: string;
  shift_date: string;
  delivery_count: number;
};

export type DeliveryOrdersReportRow = {
  driverId: string;
  empId: string;
  mgId: string;
  driver: string;
  store: string;
  position: string;
  counts: Record<string, number>;
};

export type DeliveryOrdersReportData = {
  from: string;
  to: string;
  days: string[];
  dayHeaders: string[];
  rows: DeliveryOrdersReportRow[];
};

const POSITION_DEFAULT = "Bike";

/** Inclusive YYYY-MM-DD range. */
export function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  let cur = from;
  while (cur <= to) {
    days.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    cur = next.toISOString().slice(0, 10);
  }
  return days;
}

/** Format as d-MMM (e.g. 1-Apr) to match the reference sheet. */
export function formatDayHeader(ymd: string): string {
  const day = parseInt(ymd.split("-")[2] ?? "1", 10);
  const dt = new Date(`${ymd}T12:00:00Z`);
  const month = dt.toLocaleString("en", { month: "short", timeZone: "UTC" });
  return `${day}-${month}`;
}

export function pivotDeliveryOrdersReport(
  from: string,
  to: string,
  rpcRows: DeliveryOrdersReportRpcRow[],
): DeliveryOrdersReportData {
  const days = enumerateDays(from, to);
  const dayHeaders = days.map(formatDayHeader);

  const byDriver = new Map<
    string,
    Omit<DeliveryOrdersReportRow, "counts"> & { counts: Map<string, number> }
  >();

  for (const row of rpcRows) {
    let entry = byDriver.get(row.driver_id);
    if (!entry) {
      entry = {
        driverId: row.driver_id,
        empId: row.driver_code,
        mgId: row.employee_id,
        driver: row.full_name,
        store: row.store_name,
        position: POSITION_DEFAULT,
        counts: new Map(),
      };
      byDriver.set(row.driver_id, entry);
    }
    entry.counts.set(row.shift_date, Number(row.delivery_count));
  }

  const rows: DeliveryOrdersReportRow[] = [...byDriver.values()]
    .sort((a, b) => a.driver.localeCompare(b.driver))
    .map((entry) => ({
      driverId: entry.driverId,
      empId: entry.empId,
      mgId: entry.mgId,
      driver: entry.driver,
      store: entry.store,
      position: entry.position,
      counts: Object.fromEntries(days.map((day) => [day, entry.counts.get(day) ?? 0])),
    }));

  return { from, to, days, dayHeaders, rows };
}
