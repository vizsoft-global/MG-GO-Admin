import type {
  DriverAccountStatus,
  DriverCompanyTone,
  DriverListPageRow,
  DriverRiderCategory,
  DriverWorkflowStatus,
} from "./types";

/** Matches `admin_drivers_filter_kind` in 20261028600000. */
export const DRIVERS_FILTER_KINDS = {
  driverId: "text",
  mgId: "text",
  riderCategory: "list",
  companyClientId: "text",
  companyName: "list",
  name: "text",
  phone: "text",
  restaurants: "list",
  zone: "list",
  platformId: "text",
  platformName: "list",
  todayDeliveries: "range",
  status: "list",
  attendance: "list",
} as const;

export type DriversFixedColumn = keyof typeof DRIVERS_FILTER_KINDS;
export type DriversFilterKind = "text" | "list" | "range";

export type DriversTextFilter = { contains: string };
export type DriversListFilter = { in: string[] };
export type DriversRangeFilter = { min: number | null; max: number | null };
export type DriversColumnFilter = DriversTextFilter | DriversListFilter | DriversRangeFilter;
export type DriversColumnFilters = Record<string, DriversColumnFilter>;

export type DriversTab = "all" | "pending" | "on_duty" | "multi_device" | "archived";
export type DriversSortDir = "asc" | "desc";
export type DriversSort = { key: string; dir: DriversSortDir };

export const DEFAULT_DRIVERS_SORT: DriversSort = { key: "name", dir: "asc" };

const CUSTOM_COLUMN_RE = /^cf:[A-Za-z0-9_]{1,64}$/;

export function customFilterColumn(fieldKey: string): string {
  return `cf:${fieldKey}`;
}

export function isDriversFilterColumn(key: string): boolean {
  return key in DRIVERS_FILTER_KINDS || CUSTOM_COLUMN_RE.test(key);
}

export function driversFilterKind(key: string): DriversFilterKind | "custom" | null {
  if (key in DRIVERS_FILTER_KINDS) return DRIVERS_FILTER_KINDS[key as DriversFixedColumn];
  return CUSTOM_COLUMN_RE.test(key) ? "custom" : null;
}

export function isTextFilter(f: DriversColumnFilter | undefined): f is DriversTextFilter {
  return Boolean(f && "contains" in f);
}

export function isListFilter(f: DriversColumnFilter | undefined): f is DriversListFilter {
  return Boolean(f && "in" in f);
}

export function isRangeFilter(f: DriversColumnFilter | undefined): f is DriversRangeFilter {
  return Boolean(f && ("min" in f || "max" in f));
}

export function isFilterActive(f: DriversColumnFilter | undefined): boolean {
  if (!f) return false;
  if (isTextFilter(f)) return f.contains.trim() !== "";
  if (isListFilter(f)) return f.in.length > 0;
  return f.min != null || f.max != null;
}

/** Drops unknown columns, wrong shapes and empty values so the RPC never sees them. */
export function sanitizeDriversFilters(filters: DriversColumnFilters): DriversColumnFilters {
  const out: DriversColumnFilters = {};
  for (const [key, f] of Object.entries(filters)) {
    const kind = driversFilterKind(key);
    if (!kind || !isFilterActive(f)) continue;
    if (isTextFilter(f) && (kind === "text" || kind === "custom")) {
      out[key] = { contains: f.contains.trim().slice(0, 200) };
    } else if (isListFilter(f) && (kind === "list" || kind === "custom")) {
      out[key] = { in: [...new Set(f.in.map(String))].slice(0, 500) };
    } else if (isRangeFilter(f) && kind === "range") {
      const min = Number.isFinite(f.min) ? f.min : null;
      const max = Number.isFinite(f.max) ? f.max : null;
      if (min != null || max != null) out[key] = { min, max };
    }
  }
  return out;
}

export function countActiveFilters(filters: DriversColumnFilters): number {
  return Object.values(filters).filter(isFilterActive).length;
}

export function withColumnFilter(
  filters: DriversColumnFilters,
  column: string,
  next: DriversColumnFilter | null,
): DriversColumnFilters {
  const copy = { ...filters };
  if (next && isFilterActive(next)) copy[column] = next;
  else delete copy[column];
  return copy;
}

/** Header click cycles asc → desc → default. */
export function nextSort(current: DriversSort, column: string): DriversSort {
  if (current.key !== column) return { key: column, dir: "asc" };
  if (current.dir === "asc") return { key: column, dir: "desc" };
  return DEFAULT_DRIVERS_SORT;
}

export type DriversPageKpis = {
  total: number;
  activeToday: number;
  onlineNow: number;
  inactive: number;
  pendingVerification: number;
  suspended: number;
};

export type DriversFilterOption = { value: string; label: string | null };

type RawPageRow = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const COMPANY_TONES = new Set<DriverCompanyTone>(["mg", "partner", "unassigned"]);

export function mapDriversPageRow(raw: RawPageRow): DriverListPageRow {
  const tone = str(raw.company_tone) as DriverCompanyTone | null;
  return {
    id: String(raw.id),
    driver_code: str(raw.driver_code) ?? "",
    employee_id: str(raw.mg_id),
    full_name: str(raw.full_name) ?? "",
    phone: str(raw.phone),
    partner_id: str(raw.partner_id) ?? "",
    partner_name: str(raw.partner_name) ?? "—",
    partner_logo_url: null,
    zone_id: str(raw.zone_id) ?? "",
    zone_name: str(raw.zone_name) ?? "—",
    restaurant_ids: strArray(raw.restaurant_ids),
    restaurant_names: strArray(raw.restaurant_names),
    workflow_status: (str(raw.workflow_status) ?? "pending") as DriverWorkflowStatus,
    linked: raw.linked === true,
    linked_profile_id: str(raw.linked_profile_id),
    account_status: (str(raw.account_status) ?? "pending") as DriverAccountStatus,
    is_blocked: raw.is_blocked === true,
    blocked_reason: null,
    is_on_duty: raw.is_on_duty === true,
    today_deliveries: typeof raw.today_deliveries === "number" ? raw.today_deliveries : 0,
    app_passcode: str(raw.app_passcode),
    archived_at: str(raw.archived_at),
    avatar_url: str(raw.avatar_url),
    avatar_display_url: null,
    rider_category: (str(raw.rider_category) ?? "in_house") as DriverRiderCategory,
    source_company: str(raw.source_company),
    client_id: str(raw.client_id),
    client_name: str(raw.client_name),
    custom_fields:
      raw.custom_fields && typeof raw.custom_fields === "object" && !Array.isArray(raw.custom_fields)
        ? (raw.custom_fields as DriverListPageRow["custom_fields"])
        : {},
    company_key: str(raw.company_key),
    company_name: str(raw.company_name),
    company_client_code: str(raw.company_client_code),
    company_tone: tone && COMPANY_TONES.has(tone) ? tone : "unassigned",
  };
}
