import {
  WRONG_ACTION_SEVERITY_WEIGHT,
  type WrongActionRow,
  type WrongActionSeverity,
} from "./types";

export const WRONG_ACTION_TABS = ["all", "high", "medium", "low", "week"] as const;
export type WrongActionTab = (typeof WRONG_ACTION_TABS)[number];

export function parseWrongActionTab(value: string | null | undefined): WrongActionTab {
  if (value === "high" || value === "medium" || value === "low" || value === "week") return value;
  return "all";
}

/**
 * The Kuwait day an incident falls on. Every other date in this module is
 * displayed in Kuwait time, so "this week" has to be counted there too — a
 * browser in another zone must not see a different tab count than the score
 * that was computed from the same rows.
 */
export function kuwaitDayIndex(iso: string): number {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return Number.NaN;
  return Math.floor((ms + 3 * 60 * 60 * 1000) / 86_400_000);
}

export function isWithinLastDays(iso: string, days: number, now: Date): boolean {
  const day = kuwaitDayIndex(iso);
  if (!Number.isFinite(day)) return false;
  const today = kuwaitDayIndex(now.toISOString());
  return day <= today && day > today - days;
}

export function wrongActionMatchesTab(
  row: Pick<WrongActionRow, "severity" | "occurred_at">,
  tab: WrongActionTab,
  now: Date,
): boolean {
  if (tab === "week") return isWithinLastDays(row.occurred_at, 7, now);
  if (tab === "all") return true;
  return row.severity === tab;
}

export function wrongActionMatchesSearch(row: WrongActionRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.driver_name,
    row.driver_code,
    row.driver_zone_name,
    row.action_type,
    row.details,
    row.created_by_name,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

export function wrongActionKpis(
  rows: readonly Pick<WrongActionRow, "severity" | "occurred_at" | "driver_id">[],
  now: Date,
) {
  const bySeverity = (severity: WrongActionSeverity) =>
    rows.filter((row) => row.severity === severity).length;
  return {
    total: rows.length,
    high: bySeverity("high"),
    medium: bySeverity("medium"),
    low: bySeverity("low"),
    thisWeek: rows.filter((row) => isWithinLastDays(row.occurred_at, 7, now)).length,
    // Not a count of rows: this is what the conduct component actually adds up,
    // so an operator can see why one driver with two incidents scores below
    // another with three.
    weighted: rows.reduce((sum, row) => sum + WRONG_ACTION_SEVERITY_WEIGHT[row.severity], 0),
    driversInvolved: new Set(rows.map((row) => row.driver_id)).size,
  };
}
