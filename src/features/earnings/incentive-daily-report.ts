export type IncentiveDailyReportRow = {
  id: string;
  driver_id: string;
  driver_name: string;
  employee_id: string;
  driver_code: string;
  earn_date: string;
  restaurant_name: string;
  zone_name: string;
  deliveries: number;
  applied_rule: string;
  daily_amount_kwd: number;
  period_total_kwd: number;
};

export type IncentiveDailyReport = {
  from: string;
  to: string;
  rows: IncentiveDailyReportRow[];
};

function text(raw: unknown): string {
  if (raw == null) return "";
  return String(raw);
}

function num(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function parseIncentiveDailyReport(
  raw: unknown,
  fallbackFrom: string,
  fallbackTo: string,
): IncentiveDailyReport {
  const payload = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rowsIn = Array.isArray(payload.rows) ? payload.rows : [];
  return {
    from: text(payload.from) || fallbackFrom,
    to: text(payload.to) || fallbackTo,
    rows: rowsIn.map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        id: text(row.id),
        driver_id: text(row.driver_id),
        driver_name: text(row.driver_name) || "—",
        employee_id: text(row.employee_id),
        driver_code: text(row.driver_code),
        earn_date: text(row.earn_date).slice(0, 10),
        restaurant_name: text(row.restaurant_name),
        zone_name: text(row.zone_name),
        deliveries: num(row.deliveries),
        applied_rule: text(row.applied_rule),
        daily_amount_kwd: num(row.daily_amount_kwd),
        period_total_kwd: num(row.period_total_kwd),
      };
    }),
  };
}

export const INCENTIVE_DAILY_HEADERS = [
  "Name",
  "Employee ID",
  "Date",
  "Restaurant",
  "Zone",
  "Deliveries",
  "Applied rule",
  "Daily amount",
  "Period total",
] as const;

export function incentiveDailyReportRowCells(
  row: IncentiveDailyReportRow,
): (string | number)[] {
  return [
    row.driver_name,
    row.employee_id,
    row.earn_date,
    row.restaurant_name,
    row.zone_name,
    row.deliveries,
    row.applied_rule,
    row.daily_amount_kwd,
    row.period_total_kwd,
  ];
}
