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
import { measureOnCall } from "../core/fs-metrics";
import { getFirestore, Timestamp, type Firestore } from "../core/fs";
import { logPhases, timedPhase, type PhaseMarks } from "../perf/phase-log";
import { COLLECTIONS } from "../core/collections";
import { requireStaff, requireStaffFresh } from "../core/staff";
import { riderIsNonOperational } from "../core/operational-sections";
import { digitSubsequenceMatch, textContainsMatch } from "../core/search-text";
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
import {
  canDeferDriverJoin,
  canonicalDriversGroupBy,
  canonicalDriversSearchField,
  dedupeRestaurantEdges,
  rosterKpis,
} from "./driver-list-plan";
import { invalidateDriverHomeDailySafe } from "./driver-home";
import { sendDriverHomeRefresh } from "./driver-refresh";

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
  "employeeStatus",
  "section",
  "nationalityCategory",
  "project",
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
    case "employeeStatus":
      return row["employee_status_key"] ?? "";
    case "section":
      return asStrList(row["section_keys"]);
    case "nationalityCategory":
      return asStrList(row["nationality_category_keys"]);
    case "project":
      return row["project_key"] ?? "";
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

/** Prefix of a stored field or of one of its tokens. Column `contains` filters stay substring. */
function searchFieldValue(row: Dict, field: string): unknown {
  switch (field) {
    case "name":
      return row["full_name"];
    case "employeeId":
      return row["mg_id"];
    case "driverId":
      return row["driver_code"];
    case "civilId":
      return row["civil_id"];
    case "passport":
      return row["passport_number"];
    case "zone":
      return row["zone_name"];
    case "phone":
      return row["phone_digits"];
    default:
      return null;
  }
}

function searchMatches(row: Dict, search: string | null, searchField: string | null): boolean {
  const needle = (search ?? "").trim();
  if (needle === "") return true;
  const field = searchField && searchField !== "all" ? searchField : null;
  if (field) {
    const value = searchFieldValue(row, field);
    const text = typeof value === "string" ? value : "";
    if (field === "phone" || field === "civilId") return digitSubsequenceMatch(text, needle);
    if (textContainsMatch(text, needle)) return true;
    return field === "employeeId" || field === "driverId" ? digitSubsequenceMatch(text, needle) : false;
  }
  const fields = [
    row["full_name"],
    row["driver_code"],
    row["mg_id"],
    row["partner_name"],
    row["zone_name"],
    row["client_id"],
    row["client_name"],
    row["company_name"],
    row["company_client_code"],
    row["civil_id"],
    row["passport_number"],
    row["email"],
    row["phone_digits"],
  ];
  if (fields.some((part) => textContainsMatch(part, needle))) return true;
  if (asStrList(row["restaurant_names"]).some((name) => textContainsMatch(name, needle))) return true;
  return [row["mg_id"], row["driver_code"], row["civil_id"], row["passport_number"], row["phone_digits"]].some(
    (part) => digitSubsequenceMatch(part, needle),
  );
}

function groupKeyOf(row: Dict, groupBy: string): string {
  switch (groupBy) {
    case "employeeStatus":
      return asStr(row["employee_status_key"]) ?? "unassigned";
    case "zone":
      return asStr(row["zone_id"]) ?? "unassigned";
    case "partner":
      return asStr(row["partner_id"]) ?? "unassigned";
    case "project":
      return asStr(row["project_key"]) ?? "unassigned";
    case "company":
      return asStr(row["company_key"]) ?? "unassigned";
    case "section":
      return asStrList(row["section_keys"])[0] ?? "unassigned";
    case "nationalityCategory":
      return asStrList(row["nationality_category_keys"])[0] ?? "unassigned";
    case "riderCategory":
      return asStr(row["rider_category"]) ?? "unassigned";
    default:
      return "all";
  }
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
async function docsByIds(db: Firestore, collection: string, ids: readonly string[]) {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  const docs = [];
  for (let index = 0; index < unique.length; index += 300) {
    const chunk = unique.slice(index, index + 300);
    const snaps = await db.getAll(...chunk.map((id) => db.collection(collection).doc(id)));
    for (const snap of snaps) {
      if (snap.exists) docs.push(snap);
    }
  }
  return docs;
}

async function loadDriverRows(
  archived: boolean,
  onlyIds?: ReadonlySet<string> | null,
  phases?: PhaseMarks,
  deferLive = false,
): Promise<Dict[]> {
  if (onlyIds && onlyIds.size === 0) return [];
  const db = getFirestore();
  const marks = phases ?? {};
  const now = new Date();
  const dayStart = kuwaitDayStart(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const multiCutoff = new Date(now.getTime() - MULTI_DEVICE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [
    partnerSnap,
    zoneSnap,
    companySnap,
    restaurantLinkSnap,
    intakeRestaurantLinkSnap,
    restaurantSnap,
    deliverySnap,
    deviceSnap,
  ] =
    await timedPhase(marks, "parallelMs", () => Promise.all([
      db.collection(COLLECTIONS.partners).get(),
      db.collection(COLLECTIONS.zones).get(),
      db.collection(COLLECTIONS.sourceCompanies).get(),
      db.collection(COLLECTIONS.driverRestaurants).get(),
      db.collection(COLLECTIONS.driverIntakeRestaurants).get(),
      db.collection(COLLECTIONS.restaurants).get(),
      deferLive
        ? Promise.resolve(null)
        : db
            .collection(COLLECTIONS.deliveries)
            .where("delivered_at", ">=", Timestamp.fromDate(dayStart))
            .where("delivered_at", "<", Timestamp.fromDate(dayEnd))
            .get(),
      deferLive
        ? Promise.resolve(null)
        : db
            .collection(COLLECTIONS.driverDeviceSessions)
            .where("last_seen_at", ">=", Timestamp.fromDate(multiCutoff))
            .get(),
    ]),
    );

  const intakeDocs = onlyIds
    ? await timedPhase(marks, "intakesMs", () => docsByIds(db, COLLECTIONS.driverIntakes, [...onlyIds]))
    : await timedPhase(marks, "intakesMs", async () => (await db.collection(COLLECTIONS.driverIntakes).get()).docs);

  const intakes = intakeDocs.filter((doc) =>
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
  const profileIds: string[] = deferLive ? [] : linkedIds;
  const driverRefs = profileIds.map((id) => db.collection(COLLECTIONS.drivers).doc(id));
  if (driverRefs.length > 0) {
    const driverSnaps = await timedPhase(marks, "driversGetAllMs", () => db.getAll(...driverRefs));
    for (const snap of driverSnaps) {
      if (snap.exists) driverById.set(snap.id, (snap.data() ?? {}) as Dict);
    }
  } else {
    try {
      marks.driversGetAllMs = 0;
    } catch {
      // A broken mark must not replace the request result.
    }
  }

  /** `array_agg(name ORDER BY name, id)` from an (owner, restaurant) edge list. */
  const restaurantLinkDocs = [...restaurantLinkSnap.docs, ...intakeRestaurantLinkSnap.docs];
  const collectRestaurants = (ownerKey: string) => {
    const edges = restaurantLinkDocs.map((doc) => {
      const data = doc.data() as Dict;
      const restaurantId = asStr(data["restaurant_id"]) ?? "";
      return {
        owner: asStr(data[ownerKey]) ?? "",
        restaurantId,
        name: asStr(restaurantById.get(restaurantId)?.["name"]) ?? restaurantId,
      };
    });
    return dedupeRestaurantEdges(edges);
  };

  const intakeRestaurants = collectRestaurants("intake_id");
  const driverRestaurants = collectRestaurants("driver_id");

  const deliveriesToday = new Map<string, number>();
  for (const doc of deliverySnap?.docs ?? []) {
    const data = doc.data() as Dict;
    const driverId = asStr(data["driver_id"]);
    if (!driverId) continue;
    deliveriesToday.set(driverId, (deliveriesToday.get(driverId) ?? 0) + 1);
  }

  const multiDevice = new Set<string>();
  const devicesSeen = new Map<string, Set<string>>();
  for (const doc of deviceSnap?.docs ?? []) {
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

  // One lookup for the plates actually referenced, not the whole garage.
  const vehicleIds = new Set<string>();
  for (const doc of intakes) {
    const id = asStr(doc.get("vehicle_id"));
    if (id) vehicleIds.add(id);
  }
  for (const driver of driverById.values()) {
    const id = asStr(driver["vehicle_id"]);
    if (id) vehicleIds.add(id);
  }
  const vehicleById = new Map<string, Dict>();
  if (vehicleIds.size > 0) {
    const vehicleDocs = await timedPhase(marks, "vehiclesMs", () =>
      docsByIds(db, COLLECTIONS.vehicles, [...vehicleIds]),
    );
    for (const snap of vehicleDocs) vehicleById.set(snap.id, (snap.data() ?? {}) as Dict);
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

    const vehicleId = (driver ? asStr(driver["vehicle_id"]) : null) ?? asStr(intake["vehicle_id"]);
    const vehicle = vehicleId ? vehicleById.get(vehicleId) : undefined;

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
      vehicle_id: vehicleId,
      vehicle_label: vehicle
        ? asStr(vehicle["reg_number"]) ?? asStr(vehicle["bike_id"]) ?? null
        : null,
      // The live driver row wins, then the assigned vehicle: a car assigned
      // after approval must not keep reading as the bike the intake sheet named.
      vehicle_type_key:
        (driver ? asStr(driver["vehicle_type_key"]) : null) ??
        (vehicle ? asStr(vehicle["vehicle_type_key"]) : null) ??
        asStr(intake["vehicle_type_key"]),
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
      employee_status_key:
        asStr(intake["employee_status_key"]) ?? (driver ? asStr(driver["employee_status_key"]) : null),
      section_keys: asStrList(intake["section_keys"] ?? (driver ? driver["section_keys"] : null)),
      nationality_category_keys: asStrList(
        intake["nationality_category_keys"] ?? (driver ? driver["nationality_category_keys"] : null),
      ),
      project_key: asStr(intake["project_key"]) ?? (driver ? asStr(driver["project_key"]) : null),
      civil_id: asStr(intake["civil_id"]) ?? (driver ? asStr(driver["civil_id"]) : null),
      passport_number:
        asStr(intake["passport_number"]) ?? (driver ? asStr(driver["passport_number"]) : null),
    } satisfies Dict;
  });
}

type DriverKpis = {
  total: number;
  activeToday: number;
  onlineNow: number;
  inactive: number;
  pendingVerification: number;
  suspended: number;
};

function kpisFromRows(base: Dict[]): DriverKpis {
  return rosterKpis(
    base.map((row) => ({
      linkedProfileId:
        row["linked_profile_id"] === null || row["linked_profile_id"] === undefined
          ? null
          : String(row["linked_profile_id"]),
      workflowStatus: typeof row["workflow_status"] === "string" ? row["workflow_status"] : null,
      accountStatus: typeof row["account_status"] === "string" ? row["account_status"] : null,
      onDuty: row["is_on_duty"] === true,
    })),
  );
}

function tabTotalOf(tab: string, kpis: DriverKpis): number {
  switch (tab) {
    case "all":
    case "archived":
      return kpis.total;
    case "on_duty":
      return kpis.onlineNow;
    case "pending":
      return kpis.pendingVerification;
    default:
      return kpis.total;
  }
}

/**
 * Intake rows joined to driver status and duty only. Same predicates as
 * `kpisFromRows`. A driver with no intake is not counted.
 */
async function fleetKpiCounts(archived: boolean): Promise<DriverKpis> {
  const db = getFirestore();
  const [intakeSnap, driverSnap] = await Promise.all([
    db.collection(COLLECTIONS.driverIntakes).select("archived_at", "linked_profile_id", "workflow_status").get(),
    db.collection(COLLECTIONS.drivers).select("status", "is_on_duty").get(),
  ]);
  const driverById = new Map(driverSnap.docs.map((doc) => [doc.id, doc.data() as Dict]));
  const rows = intakeSnap.docs.filter((doc) =>
    archived ? doc.get("archived_at") != null : doc.get("archived_at") == null,
  );
  return rosterKpis(
    rows.map((doc) => {
      const linked = asStr(doc.get("linked_profile_id"));
      const driver = linked ? driverById.get(linked) : undefined;
      return {
        linkedProfileId: linked,
        workflowStatus: asStr(doc.get("workflow_status")),
        accountStatus: (driver ? asStr(driver["status"]) : null) ?? "pending",
        onDuty: driver ? driver["is_on_duty"] === true : false,
      };
    }),
  );
}

/** Driver, device and today's delivery facts for one already-sorted page. */
async function hydrateDeferredPage(rows: Dict[], phases: PhaseMarks): Promise<void> {
  const db = getFirestore();
  const linked = [...new Set(rows.map((row) => asStr(row["linked_profile_id"])).filter((id): id is string => id !== null))];
  const driverById = new Map<string, Dict>();
  if (linked.length > 0) {
    const snaps = await timedPhase(phases, "pageDriversMs", () =>
      db.getAll(...linked.map((id) => db.collection(COLLECTIONS.drivers).doc(id))),
    );
    for (const snap of snaps) {
      if (snap.exists) driverById.set(snap.id, (snap.data() ?? {}) as Dict);
    }
  } else {
    phases.pageDriversMs = 0;
  }

  const now = new Date();
  const dayStart = kuwaitDayStart(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const cutoff = new Date(now.getTime() - MULTI_DEVICE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const want = new Set(linked);
  await timedPhase(phases, "pageLiveMs", async () => {
    const deliveriesToday = new Map<string, number>();
    const multiDevice = new Set<string>();
    const [deliverySnap] = await Promise.all([
      db
        .collection(COLLECTIONS.deliveries)
        .where("delivered_at", ">=", Timestamp.fromDate(dayStart))
        .where("delivered_at", "<", Timestamp.fromDate(dayEnd))
        .select("driver_id")
        .get(),
      (async () => {
        const devicesSeen = new Map<string, Set<string>>();
        for (let index = 0; index < linked.length; index += 30) {
          const chunk = linked.slice(index, index + 30);
          if (chunk.length === 0) continue;
          const snap = await db.collection(COLLECTIONS.driverDeviceSessions).where("driver_id", "in", chunk).get();
          for (const doc of snap.docs) {
            const driverId = asStr(doc.get("driver_id"));
            const deviceId = asStr(doc.get("device_id"));
            const seen = instantOf(doc.get("last_seen_at"));
            if (!driverId || !deviceId || !seen || seen < cutoff) continue;
            const set = devicesSeen.get(driverId) ?? new Set<string>();
            set.add(deviceId);
            devicesSeen.set(driverId, set);
          }
        }
        for (const [driverId, devices] of devicesSeen) {
          if (devices.size > 1) multiDevice.add(driverId);
        }
      })(),
    ]);
    for (const doc of deliverySnap.docs) {
      const driverId = asStr(doc.get("driver_id"));
      if (!driverId || !want.has(driverId)) continue;
      deliveriesToday.set(driverId, (deliveriesToday.get(driverId) ?? 0) + 1);
    }
    const zoneIds = [...new Set(
      [...driverById.values()].map((driver) => asStr(driver["zone_id"])).filter((id): id is string => id !== null),
    )];
    const zoneName = new Map<string, string | null>();
    if (zoneIds.length > 0) {
      const zoneSnaps = await db.getAll(...zoneIds.map((id) => db.collection(COLLECTIONS.zones).doc(id)));
      for (const snap of zoneSnaps) zoneName.set(snap.id, asStr(snap.get("name")));
    }
    const vehicleIds = [...new Set(
      [...driverById.values()]
        .map((driver) => asStr(driver["vehicle_id"]))
        .concat(rows.map((row) => asStr(row["vehicle_id"])))
        .filter((id): id is string => id !== null),
    )];
    const vehicleById = new Map<string, Dict>();
    if (vehicleIds.length > 0) {
      const vehicleSnaps = await db.getAll(...vehicleIds.map((id) => db.collection(COLLECTIONS.vehicles).doc(id)));
      for (const snap of vehicleSnaps) {
        if (snap.exists) vehicleById.set(snap.id, (snap.data() ?? {}) as Dict);
      }
    }
    for (const row of rows) {
      const linkedId = asStr(row["linked_profile_id"]);
      const driver = linkedId ? driverById.get(linkedId) : undefined;
      if (!driver || !linkedId) continue;
      const zoneId = asStr(driver["zone_id"]) ?? asStr(row["zone_id"]);
      const accountStatus = asStr(driver["status"]) ?? "pending";
      const isBlocked = driver["is_blocked"] === true;
      row["mg_id"] = asStr(driver["employee_id"]) ?? asStr(row["mg_id"]);
      row["zone_id"] = zoneId;
      row["zone_name"] = zoneId ? zoneName.get(zoneId) ?? asStr(row["zone_name"]) : null;
      const vehicleId = asStr(driver["vehicle_id"]) ?? asStr(row["vehicle_id"]);
      const vehicle = vehicleId ? vehicleById.get(vehicleId) : undefined;
      row["vehicle_id"] = vehicleId;
      row["vehicle_label"] = vehicle
        ? asStr(vehicle["reg_number"]) ?? asStr(vehicle["bike_id"]) ?? null
        : asStr(row["vehicle_label"]);
      row["vehicle_type_key"] =
        asStr(driver["vehicle_type_key"]) ??
        (vehicle ? asStr(vehicle["vehicle_type_key"]) : null) ??
        asStr(row["vehicle_type_key"]);
      row["account_status"] = accountStatus;
      row["status_key"] = isBlocked ? "blocked" : accountStatus;
      row["is_blocked"] = isBlocked;
      row["is_on_duty"] = driver["is_on_duty"] === true;
      row["attendance_key"] = driver["is_on_duty"] === true ? "on_duty" : "off_duty";
      row["today_deliveries"] = deliveriesToday.get(linkedId) ?? 0;
      row["app_passcode"] = driver["archived_at"] != null ? null : asStr(driver["app_passcode"]);
      row["avatar_object_key"] = asStr(driver["avatar_object_key"]);
      row["multi_device"] = multiDevice.has(linkedId);
    }
  });
}

/**
 * The roster is about a thousand intakes. A field-start prefix query never
 * loaded a surname, a restaurant, or the digits of `EMP13123`, and one missing
 * index rejected the whole page so the panel kept the previous 953 rows.
 * `searchMatches` runs on this full roster. KPIs stay fleet-wide.
 */
async function loadDriversForList(
  archived: boolean,
  search: string | null,
  phases?: PhaseMarks,
  deferLive = false,
): Promise<{ rows: Dict[]; kpis: DriverKpis | null }> {
  const term = (search ?? "").trim();
  const rows = await loadDriverRows(archived, null, phases, term ? false : deferLive);
  if (!term) {
    const kpis = deferLive ? await timedPhase(phases ?? {}, "kpiMs", () => fleetKpiCounts(archived)) : null;
    return { rows, kpis };
  }
  try {
    return { rows, kpis: await fleetKpiCounts(archived) };
  } catch {
    return { rows, kpis: null };
  }
}

/**
 * `admin_list_drivers_page`.
 *
 * Returns one page plus the two totals the toolbar shows, and the KPI strip is
 * computed over the base (not the page) so the tiles cannot disagree with the
 * table under them.
 */
export const adminListDriversPage = measureOnCall("adminListDriversPage", async (request) => {
  const phases: PhaseMarks = {};
  try {
  await timedPhase(phases, "requireStaffMs", () => requireStaff(request, "drivers.view"));

  const data = (request.data ?? {}) as Dict;
  const tab = (pickText(data, "tab", "p_tab") ?? "all").toLowerCase();
  if (!DRIVER_TABS.has(tab)) throw new HttpsError("invalid-argument", "invalid_tab");

  const search = pickText(data, "search", "p_search");
  const searchField = canonicalDriversSearchField(pickText(data, "searchField", "p_search_field"));
  const groupBy = canonicalDriversGroupBy(pickText(data, "groupBy", "p_group_by"));
  const filters = validateFilters(data["filters"] ?? data["p_filters"] ?? {});
  const sortKey = pickText(data, "sortKey", "p_sort_key") ?? "name";
  if (!SORT_KEYS.has(sortKey) && !CUSTOM_KEY_PATTERN.test(sortKey)) {
    throw new HttpsError("invalid-argument", "invalid_sort");
  }
  const sortDir = (pickText(data, "sortDir", "p_sort_dir") ?? "asc").toLowerCase();
  const desc = sortDir === "desc";
  const limit = Math.min(Math.max(pickCount(data, 100, "limit", "p_limit"), 1), MAX_LIMIT);
  const offset = Math.max(pickCount(data, 0, "offset", "p_offset"), 0);
  const deferLive = canDeferDriverJoin({
    tab,
    search,
    filterCount: Object.keys(filters).length,
    sortKey,
  });

  const loaded = await loadDriversForList(tab === "archived", search, phases, deferLive);
  const base = loaded.rows;
  const tabbed = base.filter((row) => tabMatches(row, tab));
  const filtered = tabbed.filter(
    (row) => searchMatches(row, search, searchField) && rowMatches(row, filters),
  );

  const compareRows = (left: Dict, right: Dict): number => {
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
  };

  const sorted = await timedPhase(phases, "groupSortMs", async () =>
    [...filtered].sort((left, right) => {
      if (groupBy !== "none") {
        const byGroup = groupKeyOf(left, groupBy).localeCompare(groupKeyOf(right, groupBy));
        if (byGroup !== 0) return byGroup;
      }
      return compareRows(left, right);
    }),
  );

  const groupCounts =
    groupBy === "none"
      ? []
      : Object.entries(
          sorted.reduce<Record<string, number>>((acc, row) => {
            const key = groupKeyOf(row, groupBy);
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {}),
        ).map(([key, count]) => ({ key, count }));

  const pageRows = sorted.slice(offset, offset + limit);
  if (deferLive) await hydrateDeferredPage(pageRows, phases);

  return {
    rows: pageRows,
    filtered_total: filtered.length,
    tab_total: loaded.kpis
      ? tab === "multi_device"
        ? tabbed.length
        : tabTotalOf(tab, loaded.kpis)
      : tabbed.length,
    kpis: loaded.kpis ?? kpisFromRows(base),
    group_by: groupBy,
    group_counts: groupCounts,
  };
  } finally {
    logPhases("adminListDriversPage", phases);
  }
});

/**
 * `admin_drivers_filter_values`.
 *
 * Distinct values for one list column with every *other* filter applied. Company
 * Name additionally lists every active company, because a company added a moment
 * ago has no rider linked to it yet and would otherwise be unpickable.
 */
export const adminDriversFilterValues = measureOnCall("adminDriversFilterValues", async (request) => {
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

  const loaded = await loadDriversForList(tab === "archived", search);
  const base = loaded.rows;
  const scoped = base.filter(
    (row) =>
      tabMatches(row, tab) &&
      searchMatches(row, search, "all") &&
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

  // The choke point for every admin-side "duty off": status change, freeze and
  // the blocked clock-out all end up here. Two signals leave together — the
  // data-only `record_type: "home"` push so the phone refetches, and a snapshot
  // invalidation so the next Home response is not describing an on-duty rider.
  // A push failure is not this function's problem; the cron is the net.
  await sendDriverHomeRefresh(driverId, `duty_off:${reason}`);
  await invalidateDriverHomeDailySafe(driverId, `duty_off:${reason}`);
}

/**
 * `set_driver_account_status`.
 *
 * Activation needs a zone or a published restaurant; leaving Active always ends
 * the shift, whatever the new status is.
 */
export const setDriverAccountStatus = onCall(async (request) => {
  await requireStaffFresh(request, "drivers.manage");

  const data = (request.data ?? {}) as Dict;
  const driverId = pickId(data, "driverId", "p_driver_id");
  const status = pickText(data, "status", "p_status");

  if (!driverId) return { ok: false, error: "driver_not_found" };
  if (!status) return { ok: false, error: "missing_fields" };

  const db = getFirestore();
  const driverRef = db.collection(COLLECTIONS.drivers).doc(driverId);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) return { ok: false, error: "driver_not_found" };

  if (
    status === "active" &&
    !(await hasOpsAssignment(driverId)) &&
    !(await riderIsNonOperational((driverSnap.data() ?? {}) as Record<string, unknown>))
  ) {
    return { ok: false, error: "driver_missing_assignment" };
  }

  await driverRef.set({ status, updated_at: Timestamp.now() }, { merge: true });

  if (status !== "active") {
    await endDriverDutyKeepGps(driverId, "admin");
  }
  // Activation does not end a duty, so it is not covered by the helper above.
  await invalidateDriverHomeDailySafe(driverId, `status:${status}`);

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
  await requireStaffFresh(request, "drivers.manage");

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
    // Unblocking changes what the rider can do but not what Home counts, so the
    // push is the signal and the invalidation is one write.
    await sendDriverHomeRefresh(driverId, "unblocked");
    await invalidateDriverHomeDailySafe(driverId, "unblocked");
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

  // Blocking is the fourth duty write that used to notify nothing: the rider's
  // phone would keep showing a live Home until the next poll. Data-only push,
  // then an invalidation because the session was just closed.
  await sendDriverHomeRefresh(driverId, "blocked");
  await invalidateDriverHomeDailySafe(driverId, "blocked");

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
  await requireStaffFresh(request, "drivers.manage");

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
  await requireStaffFresh(request, "drivers.manage");

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
  const staff = await requireStaffFresh(request, "driver_devices.view");

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
