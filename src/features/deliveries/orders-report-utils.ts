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
  fromTime: string;
  toTime: string;
  days: string[];
  dayHeaders: string[];
  rows: DeliveryOrdersReportRow[];
};

const POSITION_DEFAULT = "Bike";

/** Inclusive day cap that still covers a leap year. */
export const ORDERS_REPORT_MAX_DAYS = 366;

export const DEFAULT_ORDERS_REPORT_FROM_TIME = "00:00";
export const DEFAULT_ORDERS_REPORT_TO_TIME = "23:59";

const KUWAIT_OFFSET = "+03:00";
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type OrdersReportShiftWindow = {
  shiftDate: string;
  windowStartMs: number;
  windowEndMs: number;
};

export type OrdersReportErrorKey = "invalidRange" | "rangeTooLarge" | "failed";

export function inclusiveDayCount(from: string, to: string): number {
  return enumerateDays(from, to).length;
}

export function normalizeOrdersReportTime(
  value: string | undefined,
  fallback: string,
): string {
  const raw = (value ?? "").trim().slice(0, 5);
  return HM_RE.test(raw) ? raw : fallback;
}

export function kuwaitDateTimeMs(ymd: string, hm: string): number {
  const ms = Date.parse(`${ymd}T${hm}:00${KUWAIT_OFFSET}`);
  if (!Number.isFinite(ms)) {
    throw new Error("invalid_date_range");
  }
  return ms;
}

export function assertDeliveryOrdersReportRange(
  from: string,
  to: string,
  fromTime = DEFAULT_ORDERS_REPORT_FROM_TIME,
  toTime = DEFAULT_ORDERS_REPORT_TO_TIME,
): void {
  const start = from?.slice(0, 10);
  const end = to?.slice(0, 10);
  const startHm = normalizeOrdersReportTime(fromTime, "");
  const endHm = normalizeOrdersReportTime(toTime, "");
  if (!start || !end || !HM_RE.test(startHm) || !HM_RE.test(endHm)) {
    throw new Error("invalid_date_range");
  }
  if (inclusiveDayCount(start, end) > ORDERS_REPORT_MAX_DAYS) {
    throw new Error("range_too_large");
  }
  if (kuwaitDateTimeMs(start, startHm) > kuwaitDateTimeMs(end, endHm)) {
    throw new Error("invalid_date_range");
  }
}

/** Same fallback order as report_delivery_orders: in-window, previous, nearest, calendar. */
export function attributeDeliveryShiftDate(
  deliveredAtMs: number,
  kuwaitCalendarDate: string,
  windows: OrdersReportShiftWindow[],
): string {
  const inWindow = windows
    .filter((window) => deliveredAtMs >= window.windowStartMs && deliveredAtMs < window.windowEndMs)
    .sort((a, b) => a.windowStartMs - b.windowStartMs);
  if (inWindow[0]) return inWindow[0].shiftDate;

  const previous = windows
    .filter((window) => window.windowStartMs <= deliveredAtMs)
    .sort((a, b) => b.windowStartMs - a.windowStartMs);
  if (previous[0]) return previous[0].shiftDate;

  const nearest = [...windows].sort(
    (a, b) =>
      Math.abs(deliveredAtMs - a.windowStartMs) - Math.abs(deliveredAtMs - b.windowStartMs),
  );
  if (nearest[0]) return nearest[0].shiftDate;

  return kuwaitCalendarDate;
}

export function ordersReportErrorKey(error: unknown): OrdersReportErrorKey {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("range_too_large")) return "rangeTooLarge";
  if (message.includes("invalid_date_range")) return "invalidRange";
  return "failed";
}

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
  fromTime = DEFAULT_ORDERS_REPORT_FROM_TIME,
  toTime = DEFAULT_ORDERS_REPORT_TO_TIME,
): DeliveryOrdersReportData {
  const days = enumerateDays(from, to);
  const dayHeaders = days.map(formatDayHeader);
  const startHm = normalizeOrdersReportTime(fromTime, DEFAULT_ORDERS_REPORT_FROM_TIME);
  const endHm = normalizeOrdersReportTime(toTime, DEFAULT_ORDERS_REPORT_TO_TIME);

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

  return { from, to, fromTime: startHm, toTime: endHm, days, dayHeaders, rows };
}
