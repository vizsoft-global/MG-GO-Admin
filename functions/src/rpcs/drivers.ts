/**
 * Drivers list, filters and restriction RPCs.
 *
 * The SQL originals (`admin_list_drivers_page`, `admin_drivers_filter_values`,
 * `set_driver_account_status`, `set_driver_blocked`, `set_driver_frozen`,
 * `set_driver_unfrozen`, `admin_set_driver_force_update`,
 * `admin_driver_app_install_versions`) were written against a denormalised
 * `admin_drivers_list_base` view. Firestore has no joins, so this module loads
 * the base collections once, synthesises the same row shape in memory and then
 * applies the same tab / search / filter / sort / page rules the SQL applied.
 *
 * Ordering matters and is not incidental: filters, sort keys, sort directions
 * and error strings are byte-for-byte the ones the panel sends and reads, so a
 * row that matched in Postgres matches here.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireStaff } from "../core/staff";
import {
  logDriverOperation,
  pickBoolean,
  pickCount,
  pickId,
  pickIdList,
  pickText,
  pickTriBool,
  type Dict,
} from "./_shared";

/** Asia/Kuwait is a fixed UTC+3 with no DST, so the day boundary is arithmetic. */
const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;

const DRIVER_TABS = new Set(["all", "pending", "on_duty", "multi_device", "archived"]);

const TEXT_FILTER_KEYS = new Set([
  "driverId",
  "mgId",
  "companyClientId",
  "name",
  "phone",
  "platformId",
]);

const LIST_FILTER_KEYS = new Set([
  "riderCategory",
  "companyName",
  "zone",
  "restaurants",
  "status",
  "attendance",
  "platformName",
]);

const SORT_KEYS = new Set([
  "driverId",
  "mgId",
  "riderCategory",
  "companyClientId",
  "companyName",
  "name",
  "phone",
  "restaurants",
  "zone",
  "platformId",
  "platformName",
  "todayDeliveries",
  "status",
  "attendance",
]);

const CUSTOM_KEY_PATTERN = /^cf:[A-Za-z0-9_]{1,64}$/;
const MULTI_DEVICE_WINDOW_DAYS = 7;
const MAX_LIMIT = 5000;

type FilterShape = {
  contains?: unknown;
  in?: unknown;
  min?: unknown;
  max?: unknown;
};

type Filters = Record<string, FilterShape>;

function asStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStrList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function instantOf(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** The Kuwait calendar date (`YYYY-MM-DD`) at an instant. */
function kuwaitYmd(now: Date): string {
  return new Date(now.getTime() + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant Kuwait's current day started, expressed in UTC. */
function kuwaitDayStart(now: Date): Date {
  const [year, month, day] = kuwaitYmd(now).split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day) - KUWAIT_OFFSET_MS);
}

/** `admin_drivers_column_value`. */
function columnValue(row: Dict, key: string): unknown {
  switch (key) {
    case "driverId":
      return row["driver_code"] ?? null;
    case "mgId":
      return row["mg_id"] ?? null;
    case "riderCategory":
      return row["rider_category"] ?? null;
    case "companyClientId":
      return row["company_client_code"] ?? null;
    case "companyName":
      return row["company_key"] ?? "";
    case "name":
      return row["full_name"] ?? null;
    case "phone":
      return row["phone_digits"] ?? null;
    case "restaurants":
      return asStrList(row["restaurant_ids"]);
    case "zone":
      return row["zone_id"] ?? "";
    case "platformId":
      return row["client_id"] ?? null;
    case "platformName":
      return row["client_name"] ?? "";
    case "todayDeliveries":
      return row["today_deliveries"] ?? null;
    case "status":
      return row["status_key"] ?? null;
    case "attendance":
      return row["attendance_key"] ?? null;
    default: {
      if (key.startsWith("cf:")) {
        const fields = (row["custom_fields"] ?? {}) as Dict;
        return fields[key.slice(3)] ?? null;
      }
      return null;
    }
  }
}

/** `admin_drivers_filter_kind`. */
function filterKind(key: string): "text" | "list" | "range" | "custom" | null {
  if (TEXT_FILTER_KEYS.has(key)) return "text";
  if (LIST_FILTER_KEYS.has(key)) return "list";
  if (key === "todayDeliveries") return "range";
  if (CUSTOM_KEY_PATTERN.test(key)) return "custom";
  return null;
}

/** `admin_drivers_validate_filters` — `invalid_filter` on any wrong shape. */
function validateFilters(filters: unknown): Filters {
  if (filters === null || filters === undefined) return {};
  if (typeof filters !== "object" || Array.isArray(filters)) {
    throw new HttpsError("invalid-argument", "invalid_filter");
  }
  const entries = Object.entries(filters as Record<string, unknown>);
  const out: Filters = {};
  for (const [key, raw] of entries) {
    const kind = filterKind(key);
    if (kind === null || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new HttpsError("invalid-argument", "invalid_filter");
    }
    const shape = raw as FilterShape;
    if ("contains" in shape) {
      if ((kind !== "text" && kind !== "custom") || typeof shape.contains !== "string") {
        throw new HttpsError("invalid-argument", "invalid_filter");
      }
    } else if ("in" in shape) {
      if (
        (kind !== "list" && kind !== "custom") ||
        !Array.isArray(shape.in) ||
        shape.in.length > 500
      ) {
        throw new HttpsError("invalid-argument", "invalid_filter");
      }
    } else if ("min" in shape || "max" in shape) {
      const minOk =
        !("min" in shape) || shape.min === null || typeof shape.min === "number";
      const maxOk =
        !("max" in shape) || shape.max === null || typeof shape.max === "number";
      if (kind !== "range" || !minOk || !maxOk) {
        throw new HttpsError("invalid-argument", "invalid_filter");
      }
    } else {
      throw new HttpsError("invalid-argument", "invalid_filter");
    }
    out[key] = shape;
  }
  return out;
}

/**
 * `admin_drivers_row_matches`.
 *
 * `skip` is how a facet popup lists every value the column could take instead of
 * only the ones its own current selection left behind — Excel behaviour.
 */
function rowMatches(row: Dict, filters: Filters, skip?: string): boolean {
  for (const [key, shape] of Object.entries(filters)) {
    if (key === skip) continue;
    const value = columnValue(row, key);

    if ("contains" in shape) {
      let needle = String(shape.contains ?? "")
        .trim()
        .toLowerCase();
      if (key === "phone") needle = needle.replace(/\D/g, "");
      if (needle === "") continue;
      const text =
        value === null || value === undefined
          ? ""
          : Array.isArray(value)
            ? asStrList(value).join(" ")
            : String(value);
      if (!text.toLowerCase().includes(needle)) return false;
      continue;
    }

    if ("in" in shape) {
      const wanted = asStrList(shape.in);
      if (wanted.length === 0) continue;
      if (Array.isArray(value)) {
        const items = asStrList(value);
        if (items.length === 0) {
          if (!wanted.includes("")) return false;
        } else if (!items.some((item) => wanted.includes(item))) {
          return false;
        }
      } else {
        const text = value === null || value === undefined ? "" : String(value);
        if (!wanted.includes(text)) return false;
      }
      continue;
    }

    const numeric = asNum(value);
    if (numeric === null) return false;
    const min = asNum(shape.min);
    const max = asNum(shape.max);
    if (min !== null && numeric < min) return false;
    if (max !== null && numeric > max) return false;
  }
  return true;
}

/** `admin_drivers_search_matches`. */
function searchMatches(row: Dict, search: string | null): boolean {
  const needle = (search ?? "").trim();
  if (needle === "") return true;
  const haystack = [
    row["full_name"],
    row["driver_code"],
    row["mg_id"],
    row["partner_name"],
    row["zone_name"],
    row["client_id"],
    row["client_name"],
    row["company_name"],
    row["company_client_code"],
  ]
    .map((part) => (typeof part === "string" ? part : ""))
    .join(" ")
    .toLowerCase();
  if (haystack.includes(needle.toLowerCase())) return true;
  const digits = needle.replace(/\D/g, "");
  if (digits === "") return false;
  return String(row["phone_digits"] ?? "").includes(digits);
}

/** `admin_drivers_tab_matches`. */
function tabMatches(row: Dict, tab: string): boolean {
  switch (tab) {
    case "pending":
      return (
        row["linked_profile_id"] === null ||
        row["linked_profile_id"] === undefined ||
        row["workflow_status"] === "pending" ||
        row["account_status"] === "pending"
      );
    case "on_duty":
      return row["is_on_duty"] === true;
    case "multi_device":
      return row["multi_device"] === true;
    default:
      return true;
  }
}

/** The order key `admin_list_drivers_page` sorts on for one row. */
function sortText(row: Dict, sortKey: string): string | null {
  if (sortKey === "companyName") return lowerOrNull(asStr(row["company_name"]));
  if (sortKey === "zone") return lowerOrNull(asStr(row["zone_name"]));
  if (sortKey === "platformName") return lowerOrNull(asStr(row["client_name"]));
  if (sortKey === "restaurants") {
    return lowerOrNull(asStrList(row["restaurant_names"]).join(", "));
  }
  const value = columnValue(row, sortKey);
  const parts = Array.isArray(value) ? asStrList(value) : value === null || value === undefined ? [] : [String(value)];
  return lowerOrNull(parts.join(", "));
}

function lowerOrNull(value: string | null): string | null {
  if (value === null) return null;
  return value === "" ? null : value.toLowerCase();
}

/** Ascending or descending, with null always last — the SQL's `NULLS LAST`. */
function compareNullable(
  left: string | number | null,
  right: string | number | null,
  desc: boolean,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === "number" && typeof right === "number") {
    return desc ? right - left : left - right;
  }
  const a = String(left);
  const b = String(right);
  if (a === b) return 0;
  const ordered = a < b ? -1 : 1;
  return desc ? -ordered : ordered;
}

/**
 * `admin_drivers_list_base` — the denormalised row, assembled from one read of
 * each base collection.
 */
async function loadDriverRows(archived: boolean): Promise<Dict[]> {
  const db = getFirestore();
  const now = new Date();
  const dayStart = kuwaitDayStart(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const multiCutoff = new Date(now.getTime() - MULTI_DEVICE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [intakeSnap, partnerSnap, zoneSnap, companySnap, intakeRestSnap, driverRestSnap, restaurantSnap, deliverySnap, deviceSnap] =
    await Promise.all([
      db.collection(COLLECTIONS.driverIntakes).get(),
      db.collection(COLLECTIONS.partners).get(),
      db.collection(COLLECTIONS.zones).get(),
      db.collection(COLLECTIONS.sourceCompanies).get(),
      db.collection(COLLECTIONS.driverRestaurants).get(),
      db.collection(COLLECTIONS.driverRestaurants).get(),
      db.collection(COLLECTIONS.restaurants).get(),
      db
        .collection(COLLECTIONS.deliveries)
        .where("delivered_at", ">=", Timestamp.fromDate(dayStart))
        .where("delivered_at", "<", Timestamp.fromDate(dayEnd))
        .get(),
      db
        .collection(COLLECTIONS.driverDeviceSessions)
        .where("last_seen_at", ">=", Timestamp.fromDate(multiCutoff))
        .get(),
    ]);

  const intakes = intakeSnap.docs.filter((doc) =>
    archived ? doc.get("archived_at") != null : doc.get("archived_at") == null,
  );

  const partnerById = new Map(partnerSnap.docs.map((doc) => [doc.id, doc.data() as Dict]));
  const zoneById = new Map(zoneSnap.docs.map((doc) => [doc.id, doc.data() as Dict]));
  const restaurantById = new Map(restaurantSnap.docs.map((doc) => [doc.id, doc.data() as Dict]));
  const companyByKey = new Map<string, Dict>();
  for (const doc of companySnap.docs) {
    const data = doc.data() as Dict;
    const key = asStr(data["key"]);
    if (key) companyByKey.set(key, data);
  }

  const linkedIds = intakes
    .map((doc) => asStr(doc.get("linked_profile_id")))
    .filter((id): id is string => id !== null);

  const driverById = new Map<string, Dict>();
  const profileIds: string[] = linkedIds;
  const driverRefs = profileIds.map((id) => db.collection(COLLECTIONS.drivers).doc(id));
  if (driverRefs.length > 0) {
    const driverSnaps = await db.getAll(...driverRefs);
    for (const snap of driverSnaps) {
      if (snap.exists) driverById.set(snap.id, (snap.data() ?? {}) as Dict);
    }
  }

  /** `array_agg(name ORDER BY name, id)` from an (owner, restaurant) edge list. */
  const collectRestaurants = (ownerKey: string) => {
    const byOwner = new Map<string, { id: string; name: string }[]>();
    for (const doc of [...intakeRestSnap.docs, ...driverRestSnap.docs]) {
      const data = doc.data() as Dict;
      const owner = asStr(data[ownerKey]);
      const restaurantId = asStr(data["restaurant_id"]);
      if (!owner || !restaurantId) continue;
      const name = asStr(restaurantById.get(restaurantId)?.["name"]) ?? restaurantId;
      const bucket = byOwner.get(owner) ?? [];
      bucket.push({ id: restaurantId, name });
      byOwner.set(owner, bucket);
    }
    for (const bucket of byOwner.values()) {
      bucket.sort((a, b) => (a.name === b.name ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name)));
    }
    return byOwner;
  };

  const intakeRestaurants = collectRestaurants("intake_id");
  const driverRestaurants = collectRestaurants("driver_id");

  const deliveriesToday = new Map<string, number>();
  for (const doc of deliverySnap.docs) {
    const data = doc.data() as Dict;
    const driverId = asStr(data["driver_id"]);
    if (!driverId) continue;
    deliveriesToday.set(driverId, (deliveriesToday.get(driverId) ?? 0) + 1);
  }

  const multiDevice = new Set<string>();
  const devicesSeen = new Map<string, Set<string>>();
  for (const doc of deviceSnap.docs) {
    const data = doc.data() as Dict;
    const driverId = asStr(data["driver_id"]);
    const deviceId = asStr(data["device_id"]);
    if (!driverId || !deviceId) continue;
    const set = devicesSeen.get(driverId) ?? new Set<string>();
    set.add(deviceId);
    devicesSeen.set(driverId, set);
  }
  for (const [driverId, devices] of devicesSeen) {
    if (devices.size > 1) multiDevice.add(driverId);
  }

  return intakes.map((doc) => {
    const intake = doc.data() as Dict;
    const linkedProfileId = asStr(intake["linked_profile_id"]);
    const driver = linkedProfileId ? driverById.get(linkedProfileId) : undefined;
    const partnerId = asStr(intake["partner_id"]);
    const zoneId = (driver ? asStr(driver["zone_id"]) : null) ?? asStr(intake["zone_id"]);
    const riderCategory = asStr(intake["rider_category"]) ?? "in_house";

    const restaurantEdges = linkedProfileId
      ? driverRestaurants.get(linkedProfileId)
      : intakeRestaurants.get(doc.id);
    const restaurantIds = (restaurantEdges ?? []).map((edge) => edge.id);
    const restaurantNames = (restaurantEdges ?? []).map((edge) => edge.name);

    const companyKey =
      riderCategory === "in_house" ? "mg" : asStr(intake["source_company"]);
    const company = companyKey ? companyByKey.get(companyKey) : undefined;

    const accountStatus = (driver ? asStr(driver["status"]) : null) ?? "pending";
    const isBlocked = driver ? driver["is_blocked"] === true : false;

    return {
      id: doc.id,
      created_at: instantOf(intake["created_at"]),
      driver_code: asStr(intake["driver_code"]),
      mg_id: linkedProfileId
        ? (driver ? asStr(driver["employee_id"]) : null) ?? asStr(intake["employee_id"])
        : asStr(intake["employee_id"]),
      full_name: asStr(intake["full_name"]),
      phone: asStr(intake["phone"]),
      phone_digits: String(intake["phone"] ?? "").replace(/\D/g, "") || null,
      partner_id: partnerId,
      partner_name: partnerId ? asStr(partnerById.get(partnerId)?.["name"]) : null,
      partner_logo_key: partnerId ? asStr(partnerById.get(partnerId)?.["logo_url"]) : null,
      zone_id: zoneId,
      zone_name: zoneId ? asStr(zoneById.get(zoneId)?.["name"]) : null,
      restaurant_ids: restaurantIds,
      restaurant_names: restaurantNames,
      workflow_status: asStr(intake["workflow_status"]),
      linked: intake["linked"] === true,
      linked_profile_id: linkedProfileId,
      account_status: accountStatus,
      status_key: isBlocked ? "blocked" : accountStatus,
      is_blocked: isBlocked,
      is_on_duty: driver ? driver["is_on_duty"] === true : false,
      attendance_key: driver && driver["is_on_duty"] === true ? "on_duty" : "off_duty",
      today_deliveries: linkedProfileId ? deliveriesToday.get(linkedProfileId) ?? 0 : 0,
      app_passcode:
        intake["archived_at"] != null ? null : driver ? asStr(driver["app_passcode"]) : null,
      archived_at: instantOf(intake["archived_at"]),
      avatar_url: asStr(intake["avatar_url"]),
      avatar_object_key: driver ? asStr(driver["avatar_object_key"]) : null,
      rider_category: riderCategory,
      source_company: asStr(intake["source_company"]),
      company_key: company ? asStr(company["key"]) : null,
      company_name: company ? asStr(company["name"]) : null,
      company_client_code: company ? asStr(company["client_code"]) : null,
      company_tone: !company ? "unassigned" : company["is_system"] === true ? "mg" : "partner",
      client_id: asStr(intake["client_id"]),
      client_name: asStr(intake["client_name"]),
      custom_fields: (intake["custom_fields"] ?? {}) as Dict,
      multi_device: linkedProfileId !== null && multiDevice.has(linkedProfileId),
    } satisfies Dict;
  });
}

/**
 * `admin_list_drivers_page`.
 *
 * Returns one page plus the two totals the toolbar shows, and the KPI strip is
 * computed over the base (not the page) so the tiles cannot disagree with the
 * table under them.
 */
export const adminListDriversPage = onCall(async (request) => {
  await requireStaff(request, "drivers.view");

  const data = (request.data ?? {}) as Dict;
  const tab = (pickText(data, "tab", "p_tab") ?? "all").toLowerCase();
  if (!DRIVER_TABS.has(tab)) throw new HttpsError("invalid-argument", "invalid_tab");

  const search = pickText(data, "search", "p_search");
  const filters = validateFilters(data["filters"] ?? data["p_filters"] ?? {});
  const sortKey = pickText(data, "sortKey", "p_sort_key") ?? "name";
  if (!SORT_KEYS.has(sortKey) && !CUSTOM_KEY_PATTERN.test(sortKey)) {
    throw new HttpsError("invalid-argument", "invalid_sort");
  }
  const sortDir = (pickText(data, "sortDir", "p_sort_dir") ?? "asc").toLowerCase();
  const desc = sortDir === "desc";
  const limit = Math.min(Math.max(pickCount(data, 100, "limit", "p_limit"), 1), MAX_LIMIT);
  const offset = Math.max(pickCount(data, 0, "offset", "p_offset"), 0);

  const base = await loadDriverRows(tab === "archived");
  const tabbed = base.filter((row) => tabMatches(row, tab));
  const filtered = tabbed.filter(
    (row) => searchMatches(row, search) && rowMatches(row, filters),
  );

  const sorted = [...filtered].sort((left, right) => {
    if (sortKey === "todayDeliveries") {
      const byNumber = compareNullable(
        asNum(left["today_deliveries"]),
        asNum(right["today_deliveries"]),
        desc,
      );
      if (byNumber !== 0) return byNumber;
    } else {
      const byText = compareNullable(sortText(left, sortKey), sortText(right, sortKey), desc);
      if (byText !== 0) return byText;
    }
    return String(left["id"]).localeCompare(String(right["id"]));
  });

  return {
    rows: sorted.slice(offset, offset + limit),
    filtered_total: filtered.length,
    tab_total: tabbed.length,
    kpis: {
      total: base.length,
      activeToday: base.filter((row) => row["account_status"] === "active").length,
      onlineNow: base.filter((row) => row["is_on_duty"] === true).length,
      inactive: base.filter(
        (row) => row["account_status"] === "active" && row["is_on_duty"] !== true,
      ).length,
      pendingVerification: base.filter(
        (row) =>
          row["linked_profile_id"] === null ||
          row["workflow_status"] === "pending" ||
          row["account_status"] === "pending",
      ).length,
      suspended: base.filter((row) => row["account_status"] === "suspended").length,
    },
  };
});

/**
 * `admin_drivers_filter_values`.
 *
 * Distinct values for one list column with every *other* filter applied. Company
 * Name additionally lists every active company, because a company added a moment
 * ago has no rider linked to it yet and would otherwise be unpickable.
 */
export const adminDriversFilterValues = onCall(async (request) => {
  await requireStaff(request, "drivers.view");

  const data = (request.data ?? {}) as Dict;
  const column = pickText(data, "column", "p_column");
  if (!column) throw new HttpsError("invalid-argument", "invalid_filter");

  const tab = (pickText(data, "tab", "p_tab") ?? "all").toLowerCase();
  if (!DRIVER_TABS.has(tab)) throw new HttpsError("invalid-argument", "invalid_tab");

  const kind = filterKind(column);
  if (kind !== "list" && kind !== "custom") {
    throw new HttpsError("invalid-argument", "invalid_filter");
  }

  const search = pickText(data, "search", "p_search");
  const filters = validateFilters(data["filters"] ?? data["p_filters"] ?? {});

  const base = await loadDriverRows(tab === "archived");
  const scoped = base.filter(
    (row) =>
      tabMatches(row, tab) &&
      searchMatches(row, search) &&
      rowMatches(row, filters, column),
  );

  const seen = new Map<string, string | null>();
  const push = (value: string | null, label: string | null) => {
    if (value === null) return;
    if (!seen.has(value)) seen.set(value, label);
  };

  for (const row of scoped) {
    if (column === "restaurants") {
      const ids = asStrList(row["restaurant_ids"]);
      const names = asStrList(row["restaurant_names"]);
      ids.forEach((id, index) => push(id, names[index] ?? null));
      continue;
    }
    if (column === "companyName") {
      push(String(row["company_key"] ?? ""), asStr(row["company_name"]));
      continue;
    }
    if (column === "zone") {
      push(String(row["zone_id"] ?? ""), asStr(row["zone_name"]));
      continue;
    }
    if (column === "platformName") {
      const name = asStr(row["client_name"]);
      push(name ?? "", name);
      continue;
    }
    if (column === "riderCategory") {
      push(asStr(row["rider_category"]), null);
      continue;
    }
    if (column === "status") {
      push(asStr(row["status_key"]), null);
      continue;
    }
    if (column === "attendance") {
      push(asStr(row["attendance_key"]), null);
      continue;
    }
    if (column.startsWith("cf:")) {
      const rawValue = (row["custom_fields"] as Dict)[column.slice(3)];
      const parts = Array.isArray(rawValue) ? asStrList(rawValue) : rawValue === null || rawValue === undefined ? [""] : [String(rawValue)];
      for (const part of parts) push(part, part);
    }
  }

  if (column === "companyName") {
    const companySnap = await getFirestore()
      .collection(COLLECTIONS.sourceCompanies)
      .where("is_active", "==", true)
      .get();
    for (const doc of companySnap.docs) {
      const company = doc.data() as Dict;
      push(asStr(company["key"]), asStr(company["name"]));
    }
  }

  const values = [...seen.entries()]
    .filter(([value]) => value !== null)
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => {
      const leftBlank = left.value === "" ? 1 : 0;
      const rightBlank = right.value === "" ? 1 : 0;
      if (leftBlank !== rightBlank) return leftBlank - rightBlank;
      const leftLabel = (left.label ?? left.value).toLowerCase();
      const rightLabel = (right.label ?? right.value).toLowerCase();
      return leftLabel.localeCompare(rightLabel);
    });

  return values;
});

/** `driver_has_ops_assignment` — a zone, or at least one published restaurant. */
async function hasOpsAssignment(driverId: string): Promise<boolean> {
  const db = getFirestore();
  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  if (!driverSnap.exists) return false;
  if (asStr((driverSnap.data() ?? {})["zone_id"]) !== null) return true;

  const links = await db
    .collection(COLLECTIONS.driverRestaurants)
    .where("driver_id", "==", driverId)
    .get();
  const restaurantIds = links.docs
    .map((doc) => asStr((doc.data() as Dict)["restaurant_id"]))
    .filter((id): id is string => id !== null);
  if (restaurantIds.length === 0) return false;

  for (let index = 0; index < restaurantIds.length; index += 30) {
    const group = restaurantIds.slice(index, index + 30);
    const snaps = await db.getAll(
      ...group.map((id) => db.collection(COLLECTIONS.restaurants).doc(id)),
    );
    if (
      snaps.some(
        (snap) =>
          snap.exists &&
          (snap.data() ?? {})["is_active"] === true &&
          (snap.data() ?? {})["status"] === "published",
      )
    ) {
      return true;
    }
  }
  return false;
}

/** `_end_driver_duty_keep_gps` — clock out, keep the last known position. */
async function endDriverDutyKeepGps(driverId: string, reason: string): Promise<void> {
  const db = getFirestore();
  const now = Timestamp.now();

  await db
    .collection(COLLECTIONS.drivers)
    .doc(driverId)
    .set({ is_on_duty: false, updated_at: now }, { merge: true });

  const sessions = await db
    .collection(COLLECTIONS.driverSessions)
    .where("driver_id", "==", driverId)
    .where("is_online", "==", true)
    .get();
  const batch = db.batch();
  for (const doc of sessions.docs) {
    batch.set(
      doc.ref,
      { is_online: false, went_offline_at: (doc.get("went_offline_at") ?? null) ?? now, updated_at: now },
      { merge: true },
    );
  }
  if (!sessions.empty) await batch.commit();

  const openLogs = await db
    .collection(COLLECTIONS.attendanceLogs)
    .where("driver_id", "==", driverId)
    .where("check_out_at", "==", null)
    .get();
  const logBatch = db.batch();
  for (const doc of openLogs.docs) {
    logBatch.set(
      doc.ref,
      { check_out_at: now, check_out_reason: reason, updated_at: now },
      { merge: true },
    );
  }
  if (!openLogs.empty) await logBatch.commit();
}

/**
 * `set_driver_account_status`.
 *
 * Activation needs a zone or a published restaurant; leaving Active always ends
 * the shift, whatever the new status is.
 */
export const setDriverAccountStatus = onCall(async (request) => {
  await requireStaff(request, "drivers.manage");

  const data = (request.data ?? {}) as Dict;
  const driverId = pickId(data, "driverId", "p_driver_id");
  const status = pickText(data, "status", "p_status");

  if (!driverId) return { ok: false, error: "driver_not_found" };
  if (!status) return { ok: false, error: "missing_fields" };

  const db = getFirestore();
  const driverRef = db.collection(COLLECTIONS.drivers).doc(driverId);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) return { ok: false, error: "driver_not_found" };

  if (status === "active" && !(await hasOpsAssignment(driverId))) {
    return { ok: false, error: "driver_missing_assignment" };
  }

  await driverRef.set({ status, updated_at: Timestamp.now() }, { merge: true });

  if (status !== "active") {
    await endDriverDutyKeepGps(driverId, "admin");
  }

  return { ok: true, status };
});

/**
 * `set_driver_blocked`.
 *
 * Blocking is an adverse state: it clocks the rider out, closes the online
 * session and closes the open attendance log, so a blocked phone cannot keep
 * accruing work time. Unblocking only clears the flags.
 */
export const setDriverBlocked = onCall(async (request) => {
  await requireStaff(request, "drivers.manage");

  const data = (request.data ?? {}) as Dict;
  const driverId = pickId(data, "driverId", "p_driver_id");
  const blocked = pickBoolean(data, "blocked", "p_blocked");
  const reason = pickText(data, "reason", "p_reason");

  if (!driverId) return { ok: false, error: "driver_not_found" };

  const db = getFirestore();
  const driverRef = db.collection(COLLECTIONS.drivers).doc(driverId);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) return { ok: false, error: "driver_not_found" };

  const driver = (driverSnap.data() ?? {}) as Dict;
  const wasOnDuty = driver["is_on_duty"] === true;
  const now = Timestamp.now();

  if (!blocked) {
    await driverRef.set(
      {
        is_blocked: false,
        blocked_reason: null,
        blocked_at: null,
        blocked_by: null,
        updated_at: now,
      },
      { merge: true },
    );
    await logDriverOperation({
      driverId,
      module: "duty",
      action: "duty.unblocked",
      actor: "admin",
      recordType: "driver",
      recordId: driverId,
      detail: { unblocked_by: request.auth?.uid ?? null },
    });
    return { ok: true };
  }

  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 3) return { ok: false, error: "missing_block_reason" };

  await driverRef.set(
    {
      is_blocked: true,
      blocked_reason: trimmed,
      blocked_at: now,
      blocked_by: request.auth?.uid ?? null,
      is_on_duty: false,
      updated_at: now,
    },
    { merge: true },
  );

  const sessions = await db
    .collection(COLLECTIONS.driverSessions)
    .where("driver_id", "==", driverId)
    .where("is_online", "==", true)
    .get();
  let sessionClosed = false;
  if (!sessions.empty) {
    const batch = db.batch();
    for (const doc of sessions.docs) {
      batch.set(
        doc.ref,
        {
          is_online: false,
          went_offline_at: doc.get("went_offline_at") ?? now,
          updated_at: now,
        },
        { merge: true },
      );
    }
    await batch.commit();
    sessionClosed = true;
  }

  const openLogs = await db
    .collection(COLLECTIONS.attendanceLogs)
    .where("driver_id", "==", driverId)
    .where("check_out_at", "==", null)
    .get();
  if (!openLogs.empty) {
    const batch = db.batch();
    for (const doc of openLogs.docs) {
      batch.set(
        doc.ref,
        { check_out_at: now, check_out_reason: "admin", updated_at: now },
        { merge: true },
      );
    }
    await batch.commit();
  }

  await logDriverOperation({
    driverId,
    module: "duty",
    action: "duty.blocked_checkout",
    actor: "admin",
    recordType: "driver",
    recordId: driverId,
    detail: {
      reason: trimmed,
      was_on_duty: wasOnDuty,
      session_closed: sessionClosed,
      blocked_by: request.auth?.uid ?? null,
    },
  });

  return { ok: true };
});

/**
 * `set_driver_frozen`.
 *
 * The window is inclusive on the Kuwait calendar. A freeze that is already
 * running ends the shift the moment it is saved, and `driver_freeze_is_active`
 * is re-evaluated here rather than trusted from the caller.
 */
export const setDriverFrozen = onCall(async (request) => {
  await requireStaff(request, "drivers.manage");

  const data = (request.data ?? {}) as Dict;
  const driverId = pickId(data, "driverId", "p_driver_id");
  const from = pickText(data, "frozenFrom", "p_from");
  const until = pickText(data, "frozenUntil", "p_until");
  const reason = pickText(data, "reason", "p_reason");

  if (!driverId) return { ok: false, error: "driver_not_found" };

  const db = getFirestore();
  const driverRef = db.collection(COLLECTIONS.drivers).doc(driverId);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) return { ok: false, error: "driver_not_found" };

  if (!from || !until) return { ok: false, error: "missing_freeze_window" };
  if (until < from) return { ok: false, error: "invalid_freeze_window" };

  const today = kuwaitYmd(new Date());
  if (until < today) return { ok: false, error: "freeze_ended" };

  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 3) return { ok: false, error: "missing_freeze_reason" };

  const driver = (driverSnap.data() ?? {}) as Dict;
  const wasOnDuty = driver["is_on_duty"] === true;
  const active = from <= today && today <= until;

  await driverRef.set(
    {
      frozen_from: from,
      frozen_until: until,
      freeze_reason: trimmed,
      frozen_at: Timestamp.now(),
      frozen_by: request.auth?.uid ?? null,
      updated_at: Timestamp.now(),
    },
    { merge: true },
  );

  if (active) {
    await endDriverDutyKeepGps(driverId, "admin");
    await logDriverOperation({
      driverId,
      module: "duty",
      action: "duty.frozen_checkout",
      actor: "admin",
      recordType: "driver",
      recordId: driverId,
      detail: {
        reason: trimmed,
        frozen_from: from,
        frozen_until: until,
        was_on_duty: wasOnDuty,
      },
    });
  }

  return { ok: true };
});

/** `set_driver_unfrozen`. */
export const setDriverUnfrozen = onCall(async (request) => {
  await requireStaff(request, "drivers.manage");

  const data = (request.data ?? {}) as Dict;
  const driverId = pickId(data, "driverId", "p_driver_id");
  if (!driverId) return { ok: false, error: "driver_not_found" };

  const db = getFirestore();
  const driverRef = db.collection(COLLECTIONS.drivers).doc(driverId);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) return { ok: false, error: "driver_not_found" };

  await driverRef.set(
    {
      frozen_from: null,
      frozen_until: null,
      freeze_reason: null,
      frozen_at: null,
      frozen_by: null,
      updated_at: Timestamp.now(),
    },
    { merge: true },
  );

  await logDriverOperation({
    driverId,
    module: "duty",
    action: "duty.unfrozen",
    actor: "admin",
    recordType: "driver",
    recordId: driverId,
    detail: { unfrozen_by: request.auth?.uid ?? null },
  });

  return { ok: true };
});

/**
 * `admin_set_driver_force_update`.
 *
 * Setting a floor stamps the actor; clearing it only writes rows that actually
 * carried one, so the returned count is "what changed" rather than "what was
 * sent".
 */
export const adminSetDriverForceUpdate = onCall(async (request) => {
  const staff = await requireStaff(request, "driver_devices.view");

  const data = (request.data ?? {}) as Dict;
  const driverIds = pickIdList(data, "driverIds", "p_driver_ids") ?? [];
  if (driverIds.length === 0) return { updated: 0, enabled: false };

  const enabled = pickTriBool(data, "enabled", "p_enabled") ?? false;
  const minCode = pickCount(data, 0, "minCode", "p_min_code");
  if (enabled && minCode < 1) {
    throw new HttpsError("invalid-argument", "invalid_min_code");
  }

  const db = getFirestore();
  const now = Timestamp.now();
  let updated = 0;

  for (let index = 0; index < driverIds.length; index += 400) {
    const group = driverIds.slice(index, index + 400);
    const snaps = await db.getAll(
      ...group.map((id) => db.collection(COLLECTIONS.drivers).doc(id)),
    );
    const batch = db.batch();
    let touched = 0;
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const driver = (snap.data() ?? {}) as Dict;
      if (driver["archived_at"] != null) continue;
      if (enabled) {
        batch.set(
          snap.ref,
          {
            force_app_update_at: now,
            force_app_update_min_code: minCode,
            force_app_update_by: staff.uid,
          },
          { merge: true },
        );
        touched += 1;
      } else if (driver["force_app_update_at"] != null) {
        batch.set(
          snap.ref,
          {
            force_app_update_at: null,
            force_app_update_min_code: null,
            force_app_update_by: null,
          },
          { merge: true },
        );
        touched += 1;
      }
    }
    if (touched > 0) {
      await batch.commit();
      updated += touched;
    }
  }

  return { updated, enabled };
});

/**
 * `admin_driver_app_install_versions`.
 *
 * One row per non-archived driver whose *active* device has a live session: the
 * build that phone logged in with. Read from the session rather than the driver
 * row because the adoption column the app used to write is stale for most of the
 * fleet while the session is stamped on every login.
 */
export const adminDriverAppInstallVersions = onCall(async (request) => {
  await requireStaff(request, "driver_devices.view");

  const db = getFirestore();
  const driverSnap = await db.collection(COLLECTIONS.drivers).where("archived_at", "==", null).get();

  const activeDeviceIds = driverSnap.docs
    .map((doc) => asStr(doc.get("active_device_id")))
    .filter((id): id is string => id !== null);

  const sessionByDriverDevice = new Map<string, Dict>();
  for (let index = 0; index < activeDeviceIds.length; index += 30) {
    const group = activeDeviceIds.slice(index, index + 30);
    const snap = await db
      .collection(COLLECTIONS.driverDeviceSessions)
      .where("device_id", "in", group)
      .get();
    for (const doc of snap.docs) {
      const raw = doc.data() as Dict;
      if (raw["revoked_at"] != null) continue;
      const driverId = asStr(raw["driver_id"]);
      const deviceId = asStr(raw["device_id"]);
      if (driverId && deviceId) sessionByDriverDevice.set(`${driverId}\u0000${deviceId}`, raw);
    }
  }

  return driverSnap.docs
    .map((doc) => {
      const activeDeviceId = asStr(doc.get("active_device_id"));
      const session = activeDeviceId
        ? sessionByDriverDevice.get(`${doc.id}\u0000${activeDeviceId}`)
        : undefined;
      if (!session) return null;
      return {
        driver_id: doc.id,
        app_version_code: asNum(session["app_version_code"]),
        app_version_name: asStr(session["app_version_name"]),
        last_seen_at: instantOf(session["last_seen_at"])?.toISOString() ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
});
