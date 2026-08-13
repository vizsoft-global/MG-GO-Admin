export function visitStatusVariant(
  status: string,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "completed" || status === "checked_in") return "success";
  if (status === "cancelled" || status === "no_show") return "danger";
  if (status === "confirmed") return "warning";
  return "neutral";
}

export const VISIT_STATUSES = [
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
  "cancelled",
] as const;

export type VisitBookingStatus = (typeof VISIT_STATUSES)[number];

export const DAY_OF_WEEK_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

const DEPARTMENT_BADGE_CLASSES = [
  "border-sky-200 bg-sky-50 text-sky-700",
  "border-emerald-200 bg-emerald-50 text-emerald-700",
  "border-amber-200 bg-amber-50 text-amber-700",
  "border-rose-200 bg-rose-50 text-rose-700",
  "border-violet-200 bg-violet-50 text-violet-700",
  "border-blue-200 bg-blue-50 text-blue-700",
  "border-slate-200 bg-slate-50 text-slate-700",
] as const;

function hashKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function departmentBadgeClass(key: string): string {
  const idx = hashKey(key || "other") % DEPARTMENT_BADGE_CLASSES.length;
  return DEPARTMENT_BADGE_CLASSES[idx];
}

const AVATAR_TINT_CLASSES = [
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-violet-100 text-violet-700",
  "bg-blue-100 text-blue-700",
  "bg-teal-100 text-teal-700",
] as const;

export function avatarTintClass(name: string): string {
  const idx = hashKey(name || "?") % AVATAR_TINT_CLASSES.length;
  return AVATAR_TINT_CLASSES[idx];
}

export function formatWorkingHours(row: {
  working_days: string | null;
  opening_time: string | null;
  closing_time: string | null;
}): string {
  if (!row.opening_time || !row.closing_time) return "—";
  const hours = `${row.opening_time.slice(0, 5)}–${row.closing_time.slice(0, 5)}`;
  return row.working_days ? `${row.working_days} · ${hours}` : hours;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
