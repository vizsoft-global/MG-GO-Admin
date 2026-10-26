/** Visit list windows and calendar heat. Mirrors the server KPI constants. */

export const VISIT_UPCOMING_DAYS = 7;
export const VISIT_NO_SHOW_LOOKBACK_DAYS = 7;
export const VISIT_HEAT_RATIO = 0.7;

export const VISIT_KPI_CARDS = ["today", "upcoming", "awaiting", "no_shows"] as const;
export type VisitKpiCard = (typeof VISIT_KPI_CARDS)[number];

export type VisitHeat = "idle" | "open" | "high" | "full";

export type VisitDayCount = {
  date: string;
  booked: number;
  departments: Record<string, number>;
};

export function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Same windows `adminListVisits` uses for the four KPI numbers. */
export function kpiListQuery(
  card: VisitKpiCard,
  today: string,
): { dateFrom: string; dateTo: string | null; status: string | null } {
  switch (card) {
    case "today":
      return { dateFrom: today, dateTo: today, status: null };
    case "upcoming":
      return {
        dateFrom: addDaysYmd(today, 1),
        dateTo: addDaysYmd(today, VISIT_UPCOMING_DAYS),
        status: "confirmed",
      };
    case "awaiting":
      return { dateFrom: today, dateTo: today, status: "confirmed" };
    case "no_shows":
      return {
        dateFrom: addDaysYmd(today, -VISIT_NO_SHOW_LOOKBACK_DAYS),
        dateTo: null,
        status: "no_show",
      };
    default: {
      const neverCard: never = card;
      return neverCard;
    }
  }
}

export function visitHeat(booked: number, capacity: number): VisitHeat {
  if (capacity <= 0) return booked > 0 ? "full" : "idle";
  if (booked <= 0) return "open";
  if (booked >= capacity) return "full";
  if (booked / capacity >= VISIT_HEAT_RATIO) return "high";
  return "open";
}

export function heatClass(heat: VisitHeat): string {
  switch (heat) {
    case "idle":
      return "bg-muted text-muted-foreground";
    case "open":
      return "bg-success/15 text-success";
    case "high":
      return "bg-warning/25 text-warning";
    case "full":
      return "bg-danger/15 text-danger";
    default: {
      const neverHeat: never = heat;
      return neverHeat;
    }
  }
}

/** Sunday-first month grid. `null` pads the leading and trailing cells. */
export function monthMatrix(year: number, monthIndex: number): (number | null)[] {
  const lead = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= days; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function ymd(year: number, monthIndex: number, day: number): string {
  const month = String(monthIndex + 1).padStart(2, "0");
  const date = String(day).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

export function departmentLabel(
  dept: { label_en: string; label_ar: string | null },
  locale: string,
): string {
  if (locale === "ar" && dept.label_ar?.trim()) return dept.label_ar;
  return dept.label_en;
}

export function aggregateVisitDays(
  rows: Array<{
    scheduled_date: string;
    status: string;
    department_key: string;
    branch_id?: string | null;
  }>,
  branchId = "",
): VisitDayCount[] {
  return rows.reduce<VisitDayCount[]>((days, row) => {
    if (row.status === "cancelled" || !row.scheduled_date) return days;
    if (branchId && row.branch_id !== branchId) return days;
    const found = days.find((day) => day.date === row.scheduled_date);
    const entry = found ?? { date: row.scheduled_date, booked: 0, departments: {} };
    if (!found) days.push(entry);
    entry.booked += 1;
    if (row.department_key) {
      entry.departments[row.department_key] = (entry.departments[row.department_key] ?? 0) + 1;
    }
    return days;
  }, []).sort((a, b) => a.date.localeCompare(b.date));
}

type CapacitySlot = {
  branch_id: string | null;
  department_key: string;
  slot_date: string | null;
  day_of_week: number | null;
  start_time: string;
  capacity: number;
  is_active: boolean;
};

export function slotCapacityAt(
  slots: CapacitySlot[],
  branchId: string | null,
  date: string,
  dow: number,
  departmentKey: string,
  time: string,
  fallback: number,
): number {
  const start = time.slice(0, 5);
  const matches = (slot: CapacitySlot) =>
    slot.is_active &&
    slot.department_key === departmentKey &&
    (branchId == null || slot.branch_id === branchId) &&
    slot.start_time.slice(0, 5) === start;
  const dated = slots.find((slot) => matches(slot) && slot.slot_date === date);
  if (dated) return dated.capacity;
  const template = slots.find(
    (slot) => matches(slot) && !slot.slot_date && slot.day_of_week === dow,
  );
  return template?.capacity ?? fallback;
}
