import type { DriverShiftListRow } from "@/features/driver-tracking/tracking-read-actions";

export type DriverShiftsSortKey =
  | "date_desc"
  | "date_asc"
  | "name_asc"
  | "name_desc"
  | "shift_start_asc";

export const DRIVER_SHIFTS_SORT_KEYS: DriverShiftsSortKey[] = [
  "date_desc",
  "date_asc",
  "name_asc",
  "name_desc",
  "shift_start_asc",
];

export function filterShifts(
  rows: DriverShiftListRow[],
  search: string,
  shiftType: "all" | "single" | "split",
  withinWindow: "all" | "yes" | "no",
  locked: "all" | "yes" | "no",
): DriverShiftListRow[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => {
    if (shiftType !== "all" && r.shift_type !== shiftType) return false;
    if (withinWindow === "yes" && !r.is_within_window) return false;
    if (withinWindow === "no" && r.is_within_window) return false;
    if (locked === "yes" && !r.is_locked) return false;
    if (locked === "no" && r.is_locked) return false;
    if (!q) return true;
    return (
      r.driver_name.toLowerCase().includes(q) ||
      r.driver_code.toLowerCase().includes(q) ||
      r.driver_phone.toLowerCase().includes(q)
    );
  });
}

export function sortShifts(
  rows: DriverShiftListRow[],
  sortKey: DriverShiftsSortKey,
): DriverShiftListRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    switch (sortKey) {
      case "date_asc":
        return a.shift_date.localeCompare(b.shift_date);
      case "name_asc":
        return a.driver_name.localeCompare(b.driver_name);
      case "name_desc":
        return b.driver_name.localeCompare(a.driver_name);
      case "shift_start_asc":
        return a.session1_label.localeCompare(b.session1_label);
      case "date_desc":
      default:
        return b.shift_date.localeCompare(a.shift_date);
    }
  });
  return copy;
}

export function exportDriverShiftsCsv(rows: DriverShiftListRow[]): string {
  const header = [
    "driver_code",
    "driver_name",
    "shift_date",
    "shift_type",
    "session1",
    "session2",
    "submitted_at",
    "shift_end_at",
    "shift_status",
    "minutes_late",
    "minutes_early_out",
    "in_window",
    "locked",
    "on_duty",
    "zone",
    "partner",
  ];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.driver_code,
        r.driver_name,
        r.shift_date,
        r.shift_type,
        r.session1_label,
        r.session2_label ?? "",
        r.submitted_at,
        r.shift_end_at,
        r.is_active ? "active" : r.is_expired ? "expired" : "scheduled",
        r.shift_adherence?.minutes_late ?? "",
        r.shift_adherence?.minutes_early_out ?? "",
        r.is_within_window,
        r.is_locked,
        r.is_on_duty,
        r.zone_name,
        r.partner_name,
      ]
        .map((v) => {
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    ),
  ];
  return "\uFEFF" + lines.join("\n");
}
