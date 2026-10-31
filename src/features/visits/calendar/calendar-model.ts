import { monthMatrix, ymd } from "@/features/visits/visit-board";

export type VisitCalendarDayStat = {
  booked: number;
  capacity: number;
  departments: Record<string, number>;
  closed: boolean;
  outside: boolean;
};

export type CalendarCell = {
  ymd: string;
  day: number;
  outside: boolean;
};

/** Sunday-first cells, with the previous and next month filling `monthMatrix` pads. */
export function monthCells(year: number, monthIndex: number): CalendarCell[] {
  const matrix = monthMatrix(year, monthIndex);
  const lead = matrix.findIndex((day) => day != null);
  const prevIndex = monthIndex === 0 ? 11 : monthIndex - 1;
  const prevYear = monthIndex === 0 ? year - 1 : year;
  const prevCount = new Date(year, monthIndex, 0).getDate();
  const nextIndex = monthIndex === 11 ? 0 : monthIndex + 1;
  const nextYear = monthIndex === 11 ? year + 1 : year;
  let nextDay = 1;
  return matrix.map((day, index) => {
    if (day != null) {
      return { ymd: ymd(year, monthIndex, day), day, outside: false };
    }
    if (lead > 0 && index < lead) {
      const date = prevCount - (lead - 1 - index);
      return { ymd: ymd(prevYear, prevIndex, date), day: date, outside: true };
    }
    const date = nextDay;
    nextDay += 1;
    return { ymd: ymd(nextYear, nextIndex, date), day: date, outside: true };
  });
}

export function topServices(
  departments: Record<string, number>,
  n: number,
): { key: string; count: number }[] {
  return Object.entries(departments)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, n));
}

export function serviceMix(
  days: { departments: Record<string, number> }[],
): { key: string; count: number; share: number }[] {
  const totals = new Map<string, number>();
  for (const day of days) {
    for (const [key, count] of Object.entries(day.departments)) {
      totals.set(key, (totals.get(key) ?? 0) + count);
    }
  }
  const sum = [...totals.values()].reduce((total, count) => total + count, 0);
  return [...totals.entries()]
    .map(([key, count]) => ({ key, count, share: sum > 0 ? count / sum : 0 }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function busiestDays(
  days: { date: string; booked: number; capacity: number }[],
  n = 3,
): { date: string; booked: number; capacity: number }[] {
  return [...days]
    .sort((a, b) => b.booked - a.booked || a.date.localeCompare(b.date))
    .slice(0, Math.max(0, n));
}
