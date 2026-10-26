/** Filters and day totals for `adminListVisits`. No Firestore imports. */

export type VisitListMatch = {
  status: string;
  department_key: string | null;
  branch_id: string | null;
  driver_name: string | null;
  driver_code: string | null;
  booking_code: string;
  slot_start: string | null;
};

export type VisitListFilter = {
  status?: string;
  department?: string;
  branch?: string;
  driver?: string;
  code?: string;
  slot?: string;
};

export type VisitDayPoint = {
  scheduled_date: string;
  status: string;
  department_key: string;
  branch_id: string;
};

export type VisitDayCount = {
  date: string;
  booked: number;
  departments: Record<string, number>;
};

function includes(value: string | null, query: string): boolean {
  if (!query) return true;
  return (value ?? "").toLowerCase().includes(query);
}

export function matchesVisitListFilter(row: VisitListMatch, filter: VisitListFilter): boolean {
  if (filter.status && row.status !== filter.status) return false;
  if (filter.department && row.department_key !== filter.department) return false;
  if (filter.branch && row.branch_id !== filter.branch) return false;
  if (filter.slot && (row.slot_start ?? "").slice(0, 5) !== filter.slot.slice(0, 5)) return false;
  if (filter.code && !includes(row.booking_code, filter.code.toLowerCase())) return false;
  if (filter.driver) {
    const query = filter.driver.toLowerCase();
    if (!includes(row.driver_name, query) && !includes(row.driver_code, query)) return false;
  }
  return true;
}

/** Cancelled bookings stay out of the calendar totals. `branchId` is optional. */
export function tallyVisitDays(points: VisitDayPoint[], branchId = ""): VisitDayCount[] {
  const map = new Map<string, VisitDayCount>();
  for (const point of points) {
    if (point.status === "cancelled") continue;
    if (!point.scheduled_date) continue;
    if (branchId && point.branch_id !== branchId) continue;
    let entry = map.get(point.scheduled_date);
    if (!entry) {
      entry = { date: point.scheduled_date, booked: 0, departments: {} };
      map.set(point.scheduled_date, entry);
    }
    entry.booked += 1;
    if (point.department_key) {
      entry.departments[point.department_key] = (entry.departments[point.department_key] ?? 0) + 1;
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
