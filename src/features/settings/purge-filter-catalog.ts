import type { useTranslations } from "next-intl";

/**
 * Clear by filter — the client's copy of what `admin_purge_filter_columns`
 * advertises.
 *
 * The **dialog never draws a column from this file**. The server owns
 * `{key, kind}` so a column the dialog offers can never be one the matcher does
 * not know, and `admin_purge_filter_columns` is read on every open. What lives
 * here is (a) the label for each column, (b) the entity gate the entry-point
 * button reads, so a module with no filter spec does not render a button whose
 * only outcome is an empty dialog, and (c) the shape the `p_filters` jsonb must
 * have. `purge-filter-catalog.test.ts` parses the migration and asserts this
 * table equals the server's — the drift this file could otherwise introduce is
 * a column that renders with an invented label, which the test refuses.
 */
export type PurgeFilterKind = "text" | "list" | "range";

export type PurgeFilterColumn = {
  key: string;
  kind: PurgeFilterKind;
};

/** `{contains}` / `{in: []}` / `{min,max}` — exactly what `admin_purge_col_matches` reads. */
export type PurgeFilterValue =
  | { contains: string }
  | { in: string[] }
  | { min?: number; max?: number };

export type PurgeFilters = Record<string, PurgeFilterValue>;

type PurgeFilterEntityColumns = {
  entity: string;
  columns: readonly PurgeFilterColumn[];
};

/**
 * Mirror of the migration's catalogue. Wave 1 (drivers, vehicles) is
 * hand-verified; every later branch came across from the same `CASE` block, and
 * the test pins both the key list and the kind of each one.
 */
export const PURGE_FILTER_ENTITIES: readonly PurgeFilterEntityColumns[] = [
  {
    entity: "drivers",
    columns: [
      { key: "zone", kind: "list" },
      { key: "riderCategory", kind: "list" },
      { key: "companyName", kind: "list" },
      { key: "status", kind: "list" },
      { key: "attendance", kind: "list" },
      { key: "restaurants", kind: "list" },
      { key: "platformName", kind: "list" },
      { key: "vehicleType", kind: "list" },
      { key: "todayDeliveries", kind: "range" },
    ],
  },
  {
    entity: "vehicles",
    columns: [
      { key: "kind", kind: "list" },
      { key: "condition", kind: "list" },
      { key: "carType", kind: "list" },
      { key: "typeOfUse", kind: "list" },
      { key: "fuelType", kind: "list" },
      { key: "fuelCompany", kind: "list" },
      { key: "carsCompany", kind: "list" },
      { key: "empCompany", kind: "list" },
      { key: "project", kind: "list" },
      { key: "replacement", kind: "list" },
      { key: "driver", kind: "text" },
      { key: "year", kind: "range" },
    ],
  },
  {
    entity: "deliveries",
    columns: [
      { key: "status", kind: "list" },
      { key: "zone", kind: "list" },
      { key: "partner", kind: "list" },
      { key: "restaurant", kind: "list" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "attendance",
    columns: [
      { key: "status", kind: "list" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "earnings",
    columns: [
      { key: "driver", kind: "text" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "payouts",
    columns: [
      { key: "status", kind: "list" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "requests",
    columns: [
      { key: "type", kind: "list" },
      { key: "status", kind: "list" },
      { key: "driver", kind: "text" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "visits",
    columns: [
      { key: "status", kind: "list" },
      { key: "department", kind: "list" },
      { key: "driver", kind: "text" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "notifications",
    columns: [
      { key: "status", kind: "list" },
      { key: "category", kind: "list" },
      { key: "priority", kind: "list" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "esign",
    columns: [
      { key: "status", kind: "list" },
      { key: "category", kind: "list" },
      { key: "driver", kind: "text" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "fuel",
    columns: [
      { key: "driver", kind: "text" },
      { key: "station", kind: "text" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "wrong_actions",
    columns: [
      { key: "actionType", kind: "list" },
      { key: "severity", kind: "list" },
      { key: "driver", kind: "text" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "documents",
    columns: [
      { key: "docType", kind: "list" },
      { key: "tracking", kind: "list" },
      { key: "driver", kind: "text" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "order_recon",
    columns: [
      { key: "status", kind: "list" },
      { key: "file", kind: "text" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "verifications",
    columns: [
      { key: "status", kind: "list" },
      { key: "partner", kind: "list" },
      { key: "restaurant", kind: "list" },
      { key: "driver", kind: "text" },
      { key: "date", kind: "range" },
    ],
  },
  {
    entity: "restaurants",
    columns: [
      { key: "status", kind: "list" },
      { key: "active", kind: "list" },
      { key: "partner", kind: "list" },
      { key: "zone", kind: "list" },
      { key: "name", kind: "text" },
    ],
  },
  {
    entity: "zones",
    columns: [
      { key: "zoneType", kind: "list" },
      { key: "name", kind: "text" },
    ],
  },
  {
    entity: "partners",
    columns: [{ key: "name", kind: "text" }],
  },
  {
    entity: "companies",
    columns: [
      { key: "active", kind: "list" },
      { key: "name", kind: "text" },
    ],
  },
  {
    entity: "driver_groups",
    columns: [{ key: "name", kind: "text" }],
  },
  {
    entity: "assets",
    columns: [
      { key: "category", kind: "list" },
      { key: "active", kind: "list" },
      { key: "name", kind: "text" },
    ],
  },
  {
    entity: "delivery_rules",
    columns: [
      { key: "status", kind: "list" },
      { key: "scopeType", kind: "list" },
      { key: "name", kind: "text" },
    ],
  },
  {
    entity: "incentive_rules",
    columns: [
      { key: "status", kind: "list" },
      { key: "scopeType", kind: "list" },
      { key: "period", kind: "list" },
      { key: "name", kind: "text" },
    ],
  },
];

export const PURGE_FILTER_ENTITY_SET: ReadonlySet<string> = new Set(
  PURGE_FILTER_ENTITIES.map((entry) => entry.entity),
);

export function isPurgeFilterEntity(entity: string): boolean {
  return PURGE_FILTER_ENTITY_SET.has(entity);
}

/**
 * The shared label for a column key, used when no entity override exists.
 *
 * One entry per *distinct* key rather than one per (entity, key): `status` means
 * the same thing on twelve modules, and a per-entity copy would be twelve keys
 * to keep in step for one word.
 */
export const PURGE_FILTER_COLUMN_LABELS: Readonly<Record<string, string>> = {
  zone: "Zone",
  riderCategory: "Rider category",
  companyName: "Company name",
  status: "Status",
  attendance: "Attendance",
  restaurants: "Restaurants",
  platformName: "Platform",
  vehicleType: "Vehicle type",
  todayDeliveries: "Deliveries today",
  kind: "Kind",
  condition: "Condition",
  carType: "Car type",
  typeOfUse: "Type of use",
  fuelType: "Fuel type",
  fuelCompany: "Fuel company",
  carsCompany: "Cars company",
  empCompany: "Employee company",
  project: "Project",
  replacement: "Replacement",
  driver: "Driver",
  year: "Model year",
  partner: "Partner",
  restaurant: "Restaurant",
  type: "Request type",
  department: "Department",
  category: "Category",
  priority: "Priority",
  actionType: "Action type",
  severity: "Severity",
  docType: "Document type",
  tracking: "Expiry tracking",
  file: "File name",
  station: "Station",
  active: "Active",
  name: "Name",
  zoneType: "Zone type",
  scopeType: "Scope",
  period: "Period",
};

/**
 * `date` is the one key whose meaning is genuinely different on every module —
 * a delivery's created date and a document's expiry are not the same column,
 * and a shared "Date" would let an operator filter documents by an expiry they
 * read as a creation date. Every other key is shared.
 */
export const PURGE_FILTER_COLUMN_OVERRIDES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  drivers: { todayDeliveries: "Deliveries today" },
  vehicles: { year: "Model year", kind: "Kind" },
  deliveries: { date: "Created date" },
  attendance: { date: "Log date" },
  earnings: { date: "Earn date" },
  payouts: { date: "Period start" },
  requests: { date: "Created date" },
  visits: { date: "Scheduled date" },
  notifications: { date: "Created date" },
  esign: { date: "Sent date" },
  fuel: { date: "Filled date" },
  wrong_actions: { date: "Occurred date" },
  documents: { date: "Expiry date" },
  order_recon: { date: "From date" },
  verifications: { date: "Service date" },
};

/**
 * Values whose label is a UI word rather than a database token, so they are
 * translated instead of humanised. Anything else is a database token (`pending`,
 * `in_transit`) and falls back to `humaniseFilterKey`.
 */
export const PURGE_FILTER_VALUE_LABELS: Readonly<Record<string, string>> = {
  yes: "Yes",
  no: "No",
  active: "Active",
  inactive: "Inactive",
  unassigned: "Unassigned",
};

const LABEL_NAMESPACE = "pages.settings.dataCleanup.filtered";

/**
 * The i18n key for a column, relative to `pages.settings.dataCleanup.filtered`.
 * Returns "" when neither map has learned the key yet, which makes the caller
 * fall back to a humanised form rather than paint a raw key path.
 */
export function purgeFilterColumnLabelKey(entity: string, key: string): string {
  if (PURGE_FILTER_COLUMN_OVERRIDES[entity]?.[key]) {
    return `columnOverrides.${entity}.${key}`;
  }
  if (PURGE_FILTER_COLUMN_LABELS[key]) return `columns.${key}`;
  return "";
}

/** Fully-qualified key, for the i18n test only. */
export function purgeFilterColumnMessageKey(entity: string, key: string): string | null {
  const relative = purgeFilterColumnLabelKey(entity, key);
  return relative ? `${LABEL_NAMESPACE}.${relative}` : null;
}

/**
 * Every helper below takes the translator scoped to
 * `pages.settings.dataCleanup.filtered` — the namespace `LABEL_NAMESPACE` points
 * at. Passing the parent `dataCleanup` translator would resolve `columns.status`
 * against the wrong namespace and paint a raw key path.
 */
type ColumnLabelT = ReturnType<
  typeof useTranslations<"pages.settings.dataCleanup.filtered">
>;

/**
 * `scopeType` -> "Scope type", `docType` -> "Doc type".
 *
 * Deliberately a fallback and not the primary path: it cannot translate, so it
 * exists so a newly seeded column renders as words instead of `camelCase`, and
 * the test still fails for any column in the catalogue that has no label.
 */
export function humaniseFilterKey(key: string): string {
  const spaced = key
    .replace(/[_:]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function purgeFilterColumnLabel(
  t: ColumnLabelT,
  entity: string,
  key: string,
): string {
  const relative = purgeFilterColumnLabelKey(entity, key);
  if (!relative) return humaniseFilterKey(key);
  return t(relative as "columns.status");
}

/** Server facet label wins when it is a real label; a raw token is humanised. */
export function purgeFilterValueLabel(
  t: ColumnLabelT,
  value: string,
  serverLabel?: string | null,
): string {
  if (value === "") return t("values.empty");
  const label = (serverLabel ?? "").trim();
  if (label && label !== value) return label;
  if (PURGE_FILTER_VALUE_LABELS[value]) {
    return t(`values.${value}` as "values.active");
  }
  return humaniseFilterKey(value);
}

/* ------------------------------------------------------------------ */
/* Filter shape — build, collapse and sanitise                         */
/* ------------------------------------------------------------------ */

/**
 * Drops anything the server catalogue does not advertise, and any constraint
 * left empty by the operator. A `{contains: ""}` or an `{in: []}` is not a
 * filter that matches everything — the matcher treats an empty `in` as matching
 * nothing — so an emptied chip is a filter that would quietly delete nothing,
 * and it is removed rather than sent.
 */
export function sanitisePurgeFilters(
  columns: readonly PurgeFilterColumn[],
  filters: PurgeFilters,
): PurgeFilters {
  const kindByKey = new Map(columns.map((column) => [column.key, column.kind]));
  const result: PurgeFilters = {};

  for (const [key, value] of Object.entries(filters)) {
    const kind = kindByKey.get(key);
    if (!kind) continue;

    if (kind === "range") {
      const min = (value as { min?: number }).min;
      const max = (value as { max?: number }).max;
      const hasMin = typeof min === "number" && Number.isFinite(min);
      const hasMax = typeof max === "number" && Number.isFinite(max);
      if (!hasMin && !hasMax) continue;
      result[key] = {
        ...(hasMin ? { min } : {}),
        ...(hasMax ? { max } : {}),
      };
      continue;
    }

    if (kind === "text") {
      const contains = ((value as { contains?: string }).contains ?? "").trim();
      if (!contains) continue;
      result[key] = { contains };
      continue;
    }

    const values = [...new Set((value as { in?: string[] }).in ?? [])];
    if (values.length === 0) continue;
    result[key] = { in: values };
  }

  return result;
}

/** How many constraints are active — the chip count and the footer's guard. */
export function countPurgeFilters(filters: PurgeFilters): number {
  return Object.keys(filters).length;
}

/** One-line summary of a single constraint, for the active-filter chips. */
export function describePurgeFilter(
  t: ColumnLabelT,
  column: PurgeFilterColumn,
  value: PurgeFilterValue,
): string {
  if (column.kind === "range") {
    const { min, max } = value as { min?: number; max?: number };
    if (isPurgeDateRangeColumn(column)) {
      const from = min === undefined ? t("range.any") : formatPurgeDate(min);
      const to = max === undefined ? t("range.any") : formatPurgeDate(max);
      return `${from} – ${to}`;
    }
    return `${min ?? t("range.any")} – ${max ?? t("range.any")}`;
  }
  if (column.kind === "text") {
    return (value as { contains?: string }).contains ?? "";
  }
  const values = (value as { in?: string[] }).in ?? [];
  if (values.length === 1) return values[0];
  return t("valueCount", { count: values.length });
}

/**
 * A `range` column whose values are `YYYYMMDD` integers, so the picker offers
 * two calendars rather than two number fields. Every `range` column is either
 * this or a plain count (`todayDeliveries`, `year`), and the two must not share
 * an input: `YYYYMMDD` in a number field is a date the operator cannot read.
 */
export function isPurgeDateRangeColumn(column: PurgeFilterColumn): boolean {
  return column.kind === "range" && column.key === "date";
}

/** `20261005` -> `2026-10-05`; unparseable values pass through as text. */
export function formatPurgeDate(ymd: number): string {
  const text = String(ymd);
  if (!/^\d{8}$/.test(text)) return text;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

/** `2026-10-05` -> `20261005`. Returns null for an incomplete date. */
export function parsePurgeDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return Number(`${match[1]}${match[2]}${match[3]}`);
}

/** `Date` -> `20261005`, read in Kuwait so the picker's day is the row's day. */
export function kuwaitYmdFromDate(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return Number(parts.replace(/-/g, ""));
}

export function kuwaitDateFromYmd(ymd: number): Date | null {
  const text = String(ymd);
  if (!/^\d{8}$/.test(text)) return null;
  const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T12:00:00+03:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `true` when these filters are byte-identical to the ones the server last
 * answered, so the dialog can keep rendering the previous count while the new
 * request is in flight instead of flashing an empty state.
 */
export function samePurgeFilters(a: PurgeFilters, b: PurgeFilters): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
