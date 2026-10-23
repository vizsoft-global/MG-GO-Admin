export type PayrollHeadingView = "combined" | "ao" | "app_attendance";

export type PayrollColumnConfigRow = {
  columnKey: string;
  label: string | null;
  hiddenViews: PayrollHeadingView[];
};

export const PAYROLL_HEADING_KEYS = [
  "amId",
  "mgId",
  "name",
  "restaurant",
  "restaurantId",
  "zone",
  "zoneCategory",
  "partner",
  "vehicleKind",
  "status",
  "finalOrders",
  "actualHours",
  "appTotalHours",
  "appActiveDays",
  "appAvgHours",
] as const;

export type PayrollHeadingKey = (typeof PAYROLL_HEADING_KEYS)[number];

export const COMBINED_HEADING_KEYS = [
  "amId",
  "mgId",
  "name",
  "restaurant",
  "restaurantId",
  "zone",
  "zoneCategory",
  "partner",
  "vehicleKind",
  "status",
  "finalOrders",
  "actualHours",
] as const;

export const AO_HEADING_KEYS = [
  "amId",
  "mgId",
  "name",
  "restaurant",
  "restaurantId",
  "partner",
  "zone",
  "zoneCategory",
  "vehicleKind",
  "status",
  "finalOrders",
  "actualHours",
] as const;

export const APP_ATTENDANCE_HEADING_KEYS = [
  "amId",
  "mgId",
  "name",
  "restaurant",
  "restaurantId",
  "partner",
  "zone",
  "zoneCategory",
  "vehicleKind",
  "status",
  "appTotalHours",
  "appActiveDays",
  "appAvgHours",
] as const;

export function headingKeysFor(view: PayrollHeadingView): readonly string[] {
  if (view === "combined") return COMBINED_HEADING_KEYS;
  if (view === "ao") return AO_HEADING_KEYS;
  return APP_ATTENDANCE_HEADING_KEYS;
}

export function configByKey(
  rows: readonly PayrollColumnConfigRow[] | undefined,
): Map<string, PayrollColumnConfigRow> {
  const map = new Map<string, PayrollColumnConfigRow>();
  for (const row of rows ?? []) map.set(row.columnKey, row);
  return map;
}

export function resolveColumnLabel(
  columnKey: string,
  fallback: string,
  config: ReadonlyMap<string, PayrollColumnConfigRow>,
): string {
  const custom = config.get(columnKey)?.label?.trim();
  return custom || fallback;
}

export function columnHiddenIn(
  columnKey: string,
  view: PayrollHeadingView,
  config: ReadonlyMap<string, PayrollColumnConfigRow>,
): boolean {
  return Boolean(config.get(columnKey)?.hiddenViews.includes(view));
}

export function exportLabelsFromConfig(
  config: ReadonlyMap<string, PayrollColumnConfigRow>,
  fallback: (key: string) => string,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const key of PAYROLL_HEADING_KEYS) {
    labels[key] = resolveColumnLabel(key, fallback(key), config);
  }
  return labels;
}

export function hiddenSetFor(
  view: PayrollHeadingView,
  config: ReadonlyMap<string, PayrollColumnConfigRow>,
): Set<string> {
  const hidden = new Set<string>();
  for (const key of headingKeysFor(view)) {
    if (columnHiddenIn(key, view, config)) hidden.add(key);
  }
  return hidden;
}
