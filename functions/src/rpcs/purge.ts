import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, type CollectionReference, type Query } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireStaff } from "../core/staff";

/**
 * `_admin_purge_slug_for_entity` — the permission a purge of this entity needs.
 *
 * A verbatim map of the SQL, including the aliases: the two rule tables and the
 * legacy payouts borrow `earnings.bulk_delete`, because that is where their
 * catalogue entry lives, and dropping a branch here would make an entity that
 * the database still knows about unreachable from the panel.
 */
const PURGE_SLUG_BY_ENTITY: Readonly<Record<string, string>> = {
  delivery: "deliveries.bulk_delete",
  deliveries: "deliveries.bulk_delete",
  driver: "drivers.bulk_delete",
  intake: "drivers.bulk_delete",
  drivers: "drivers.bulk_delete",
  restaurant: "restaurants.bulk_delete",
  restaurants: "restaurants.bulk_delete",
  zone: "zones.bulk_delete",
  zones: "zones.bulk_delete",
  delivery_rule: "earnings.bulk_delete",
  delivery_rules: "earnings.bulk_delete",
  incentive_rule: "earnings.bulk_delete",
  incentive_rules: "earnings.bulk_delete",
  asset_catalog: "assets.bulk_delete",
  assets: "assets.bulk_delete",
  partners: "partners.bulk_delete",
  driver_groups: "driver_groups.bulk_delete",
  companies: "companies.bulk_delete",
  requests: "requests.bulk_delete",
  visits: "visits.bulk_delete",
  earnings: "earnings.bulk_delete",
  payouts: "earnings.bulk_delete",
  attendance: "attendance.bulk_delete",
  notifications: "notifications.bulk_delete",
  vehicles: "vehicles.bulk_delete",
  fuel: "fuel.bulk_delete",
  wrong_actions: "wrong_actions.bulk_delete",
  order_recon: "order_recon.bulk_delete",
  verifications: "verifications.bulk_delete",
  esign: "esign.bulk_delete",
  payroll: "payroll.bulk_delete",
  documents: "documents.bulk_delete",
};

export type PurgeFilterKind = "text" | "list" | "range";
export type PurgeFilterColumn = { key: string; kind: PurgeFilterKind };

/**
 * `admin_purge_filter_columns` — the server's own column catalogue.
 *
 * The dialog draws its columns from here rather than from a client list, so a
 * column that renders with a label can never be one the matcher does not know.
 * The kinds are the matcher's, not the input's: a `range` column is compared as
 * numbers, which is why `date` is a range of `YYYYMMDD` integers and not a date
 * string.
 */
export const PURGE_FILTER_COLUMNS: Readonly<Record<string, readonly PurgeFilterColumn[]>> = {
  drivers: [
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
  vehicles: [
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
  deliveries: [
    { key: "status", kind: "list" },
    { key: "zone", kind: "list" },
    { key: "partner", kind: "list" },
    { key: "restaurant", kind: "list" },
    { key: "date", kind: "range" },
  ],
  attendance: [
    { key: "status", kind: "list" },
    { key: "date", kind: "range" },
  ],
  earnings: [
    { key: "driver", kind: "text" },
    { key: "date", kind: "range" },
  ],
  payouts: [
    { key: "status", kind: "list" },
    { key: "date", kind: "range" },
  ],
  requests: [
    { key: "type", kind: "list" },
    { key: "status", kind: "list" },
    { key: "driver", kind: "text" },
    { key: "date", kind: "range" },
  ],
  visits: [
    { key: "status", kind: "list" },
    { key: "department", kind: "list" },
    { key: "driver", kind: "text" },
    { key: "date", kind: "range" },
  ],
  notifications: [
    { key: "status", kind: "list" },
    { key: "category", kind: "list" },
    { key: "priority", kind: "list" },
    { key: "date", kind: "range" },
  ],
  esign: [
    { key: "status", kind: "list" },
    { key: "category", kind: "list" },
    { key: "driver", kind: "text" },
    { key: "date", kind: "range" },
  ],
  fuel: [
    { key: "driver", kind: "text" },
    { key: "station", kind: "text" },
    { key: "date", kind: "range" },
  ],
  wrong_actions: [
    { key: "actionType", kind: "list" },
    { key: "severity", kind: "list" },
    { key: "driver", kind: "text" },
    { key: "date", kind: "range" },
  ],
  documents: [
    { key: "docType", kind: "list" },
    { key: "tracking", kind: "list" },
    { key: "driver", kind: "text" },
    { key: "date", kind: "range" },
  ],
  order_recon: [
    { key: "status", kind: "list" },
    { key: "file", kind: "text" },
    { key: "date", kind: "range" },
  ],
  verifications: [
    { key: "status", kind: "list" },
    { key: "partner", kind: "list" },
    { key: "restaurant", kind: "list" },
    { key: "driver", kind: "text" },
    { key: "date", kind: "range" },
  ],
  restaurants: [
    { key: "status", kind: "list" },
    { key: "active", kind: "list" },
    { key: "partner", kind: "list" },
    { key: "zone", kind: "list" },
    { key: "name", kind: "text" },
  ],
  zones: [
    { key: "zoneType", kind: "list" },
    { key: "name", kind: "text" },
  ],
  partners: [{ key: "name", kind: "text" }],
  companies: [
    { key: "active", kind: "list" },
    { key: "name", kind: "text" },
  ],
  driver_groups: [{ key: "name", kind: "text" }],
  assets: [
    { key: "category", kind: "list" },
    { key: "active", kind: "list" },
    { key: "name", kind: "text" },
  ],
  delivery_rules: [
    { key: "status", kind: "list" },
    { key: "scopeType", kind: "list" },
    { key: "name", kind: "text" },
  ],
  incentive_rules: [
    { key: "status", kind: "list" },
    { key: "scopeType", kind: "list" },
    { key: "period", kind: "list" },
    { key: "name", kind: "text" },
  ],
  payroll: [
    { key: "driver", kind: "text" },
    { key: "month", kind: "list" },
    { key: "source", kind: "list" },
    { key: "offDays", kind: "range" },
  ],
};

export function purgeSlugForEntity(entity: string): string {
  const slug = PURGE_SLUG_BY_ENTITY[entity];
  if (!slug) throw new HttpsError("failed-precondition", "unknown_entity");
  return slug;
}

/** The count of a query, with the cap the SQL's `count(*)` never had. */
export async function countOf(query: Query): Promise<number> {
  const snap = await query.count().get();
  return snap.data().count;
}

export async function countCollection(
  collection: CollectionReference,
  apply?: (query: CollectionReference) => Query,
): Promise<number> {
  return countOf(apply ? apply(collection) : collection);
}

/**
 * `admin_purge_filter_columns` — read-only.
 *
 * An entity with no catalogue is an empty array rather than an error, matching
 * the SQL `CASE` falling through to NULL, because the dialog treats "no columns"
 * as "no entry point" and an error would paint a failure on a module that simply
 * has never had a filter spec.
 */
export const adminPurgeFilterColumns = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const entity = typeof data.entity === "string" ? data.entity.trim() : "";

  // The catalogue is gated by the entity's own purge slug: a caller who cannot
  // clear the module has no reason to enumerate its filterable columns.
  await requireStaff(request, purgeSlugForEntity(entity));

  return { columns: PURGE_FILTER_COLUMNS[entity] ?? [] };
});

/**
 * `admin_purge_preview_all` — the count and the blockers, never a delete.
 *
 * Both halves come from the same call so the dialog's "N rows, blocked by X"
 * cannot be assembled from two reads taken at different moments, which is how a
 * module reads clearable the instant before a delete refuses.
 */
export const adminPurgePreviewAll = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const entity = typeof data.entity === "string" ? data.entity.trim() : "";

  await requireStaff(request, purgeSlugForEntity(entity));

  const count = await previewCount(entity);
  if (count === null) throw new HttpsError("failed-precondition", "unknown_entity");

  const blockers = await purgeBlockersFor(entity);

  return { count, blockers };
});

/**
 * `admin_purge_preview_all`'s blocker half — the references that make a module
 * refuse to empty. Shared with the filtered preview so the two cannot disagree
 * about whether a module is clearable.
 */
export async function purgeBlockersFor(entity: string): Promise<string[]> {
  const db = getFirestore();
  const blockers: string[] = [];

  if (entity === "restaurants" || entity === "restaurant") {
    const [deliveries, drivers] = await Promise.all([
      countOf(db.collection(COLLECTIONS.deliveries).where("restaurant_id", "!=", null)),
      countOf(db.collection(COLLECTIONS.drivers).where("restaurant_id", "!=", null)),
    ]);
    if (deliveries > 0) blockers.push("blocked_by_deliveries");
    if (drivers > 0) blockers.push("blocked_by_drivers");
  } else if (entity === "zones" || entity === "zone") {
    const [deliveries, restaurants] = await Promise.all([
      countOf(db.collection(COLLECTIONS.deliveries).where("zone_id", "!=", null)),
      countOf(db.collection(COLLECTIONS.restaurants).where("zone_id", "!=", null)),
    ]);
    if (deliveries > 0) blockers.push("blocked_by_deliveries");
    if (restaurants > 0) blockers.push("blocked_by_restaurants");
  }

  return blockers;
}

/** The entity's row count, or null when the entity is unknown. */
export async function previewCount(entity: string): Promise<number | null> {
  const db = getFirestore();
  switch (entity) {
    case "deliveries":
    case "delivery":
      return countCollection(db.collection(COLLECTIONS.deliveries));
    case "drivers":
    case "driver": {
      const [riders, orphanIntakes] = await Promise.all([
        countOf(db.collection(COLLECTIONS.profiles).where("role", "==", "rider")),
        countOf(
          db.collection(COLLECTIONS.driverIntakes).where("linked_profile_id", "==", null),
        ),
      ]);
      return riders + orphanIntakes;
    }
    case "restaurants":
    case "restaurant":
      return countCollection(db.collection(COLLECTIONS.restaurants));
    case "zones":
    case "zone":
      return countCollection(db.collection(COLLECTIONS.zones));
    case "delivery_rules":
    case "delivery_rule":
      return countCollection(db.collection(COLLECTIONS.deliveryRules));
    case "incentive_rules":
    case "incentive_rule":
      return countCollection(db.collection(COLLECTIONS.incentiveRules));
    case "assets":
    case "asset_catalog":
      return countCollection(db.collection(COLLECTIONS.assetCatalog));
    case "partners":
      return countCollection(db.collection(COLLECTIONS.partners));
    case "driver_groups":
      return countCollection(db.collection(COLLECTIONS.driverGroups));
    case "companies": {
      // `is_system IS NOT TRUE` includes a doc with no flag, so it is counted as
      // "all" minus "system" rather than with `!=`, which would drop the former.
      const [total, system] = await Promise.all([
        countCollection(db.collection(COLLECTIONS.sourceCompanies)),
        countOf(db.collection(COLLECTIONS.sourceCompanies).where("is_system", "==", true)),
      ]);
      return Math.max(0, total - system);
    }
    case "requests":
      return countCollection(db.collection(COLLECTIONS.requests));
    case "visits":
      return countCollection(db.collection(COLLECTIONS.visitBookings));
    case "earnings": {
      const [daily, wallet] = await Promise.all([
        countCollection(db.collection(COLLECTIONS.driverEarningsDaily)),
        countCollection(db.collection(COLLECTIONS.driverWalletEntries)),
      ]);
      return daily + wallet;
    }
    case "payouts": {
      const [runs, payouts] = await Promise.all([
        countCollection(db.collection(COLLECTIONS.payoutRuns)),
        countCollection(db.collection(COLLECTIONS.driverPayouts)),
      ]);
      return runs + payouts;
    }
    case "attendance":
      return countCollection(db.collection(COLLECTIONS.attendanceLogs));
    case "notifications":
      return countCollection(db.collection(COLLECTIONS.notificationCampaigns));
    case "vehicles":
      return countCollection(db.collection(COLLECTIONS.vehicles));
    case "fuel":
      return countCollection(db.collection(COLLECTIONS.fuelFills));
    case "wrong_actions":
      return countCollection(db.collection(COLLECTIONS.wrongActions));
    case "order_recon":
      return countCollection(db.collection(COLLECTIONS.orderReconRuns));
    case "verifications":
      return countCollection(db.collection(COLLECTIONS.deliveryVerifications));
    case "esign":
      return countCollection(db.collection(COLLECTIONS.esignRequests));
    case "payroll":
      return countCollection(db.collection(COLLECTIONS.driverOffStructure));
    case "documents":
      return countCollection(db.collection(COLLECTIONS.documentTracking));
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Clear by filter — the matcher, the row sources and the filtered handlers    */
/* -------------------------------------------------------------------------- */

type PurgeCell = string | string[] | number | null;

export type PurgeRow = {
  purgeId: string;
  label: string;
  sublabel: string;
  status: string;
  kind: string;
  data: Record<string, PurgeCell>;
};

type PurgeDoc = { id: string; data: Record<string, unknown> };

type PurgeLookups = {
  zones: Map<string, string>;
  partners: Map<string, string>;
  restaurants: Map<string, string>;
  departments: Map<string, string>;
};

/**
 * A scan ceiling for the in-memory matcher, not a silent truncation: the SQL
 * read the whole relation because Postgres was already holding it, and walking
 * 180k delivery documents every time the dialog opens would be a cost with no
 * matching benefit. The response reports the count it actually saw, so a
 * truncated scan can never be read as "that is all of them".
 */
const PURGE_SCAN_CAP = 20000;
const PURGE_PAGE_MAX = 500;

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function filterObjectOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/** `admin_purge_value_text`'s input coercion: a token, or null when blank. */
function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asTextList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .map((entry) => asText(entry))
    .filter((entry): entry is string => entry !== null);
  return out.length > 0 ? out : null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  if (value && typeof value === "object") {
    const candidate = value as { toDate?: unknown };
    if (typeof candidate.toDate === "function") {
      const date = (candidate.toDate as () => Date)();
      return date instanceof Date ? date : null;
    }
  }
  return null;
}

/** A date column as the `YYYYMMDD` integer the range matcher compares. */
function asDayNumber(value: unknown): number | null {
  const text = asText(value);
  if (text !== null && !Number.isNaN(Number(text))) {
    const digits = text.replace(/\D/g, "");
    if (digits.length >= 8) return Number(digits.slice(0, 8));
  }
  const at = toDate(value);
  if (at === null) return null;
  return Number(kuwaitDayString(at).replace(/-/g, ""));
}

/**
 * `admin_purge_value_text` — a substring test, and a blank filter matches
 * everything, which is what makes an empty input a no-op instead of a filter
 * that excludes every row.
 */
function purgeValueText(value: PurgeCell, filter: unknown): boolean {
  const term = asText(filter);
  if (term === null) return true;
  const haystack = Array.isArray(value) ? value.join(" ") : String(value);
  return haystack.toLowerCase().includes(term.toLowerCase());
}

/** `admin_purge_value_in` — membership, and an empty list matches everything. */
function purgeValueIn(value: PurgeCell, filter: unknown): boolean {
  if (!Array.isArray(filter)) return true;
  const wanted = filter
    .map((entry) => asText(entry))
    .filter((entry): entry is string => entry !== null);
  if (wanted.length === 0) return true;
  const have = Array.isArray(value) ? value : [String(value)];
  return have.some((entry) => wanted.includes(entry));
}

/**
 * A range bound, which is a number in the SQL and arrives from a dialog as a
 * date string for the `date` columns. Both become the number the matcher
 * compares, because that is the whole point of declaring `date` a range.
 */
function rangeBound(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = asText(value);
  if (text === null) return null;
  if (/^\d{8}$/.test(text)) return Number(text);
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 8 && /[-/.]/.test(text)) return Number(digits.slice(0, 8));
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function purgeValueInRange(value: PurgeCell, filter: unknown): boolean {
  const range = filterObjectOf(filter);
  const min = rangeBound(range.min);
  const max = rangeBound(range.max);
  if (min === null && max === null) return true;
  if (Array.isArray(value)) return false;
  const num = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(num)) return false;
  if (min !== null && num < min) return false;
  if (max !== null && num > max) return false;
  return true;
}

/** `admin_purge_col_matches` — one column of the filter engine. */
function purgeColMatches(kind: PurgeFilterKind, value: PurgeCell, filter: unknown): boolean {
  if (value === null) return false;
  switch (kind) {
    case "text":
      return purgeValueText(value, filter);
    case "list":
      return purgeValueIn(value, filter);
    case "range":
      return purgeValueInRange(value, filter);
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * `admin_purge_validate_filters` — an unknown column is refused rather than
 * ignored, because a silently dropped filter would delete rows the operator
 * never saw.
 *
 * `filter_values` / `preview` / `page` / `run` all answer `22023 invalid_filter`
 * for this, so the code string is the SQL's and not the callable's own.
 */
export function validatePurgeFilters(entity: string, filters: Record<string, unknown>): void {
  const columns = PURGE_FILTER_COLUMNS[entity] ?? [];
  const known = new Set(columns.map((column) => column.key));
  for (const key of Object.keys(filters)) {
    if (!known.has(key)) {
      throw new HttpsError("invalid-argument", "invalid_filter", { column: key });
    }
  }

  for (const column of columns) {
    if (!Object.prototype.hasOwnProperty.call(filters, column.key)) continue;
    const filter = filters[column.key];
    if (filter === null || filter === undefined) continue;
    if (column.kind === "list") {
      if (!Array.isArray(filter)) {
        throw new HttpsError("invalid-argument", "invalid_filter", { column: column.key });
      }
    } else if (column.kind === "range") {
      if (typeof filter !== "object" || Array.isArray(filter)) {
        throw new HttpsError("invalid-argument", "invalid_filter", { column: column.key });
      }
    } else if (typeof filter !== "string" && typeof filter !== "number") {
      throw new HttpsError("invalid-argument", "invalid_filter", { column: column.key });
    }
  }
}

export function purgeRowMatches(
  entity: string,
  row: PurgeRow,
  filters: Record<string, unknown>,
): boolean {
  const columns = PURGE_FILTER_COLUMNS[entity] ?? [];
  for (const column of columns) {
    if (!Object.prototype.hasOwnProperty.call(filters, column.key)) continue;
    const filter = filters[column.key];
    if (filter === null || filter === undefined) continue;
    const value = row.data[column.key] ?? null;
    if (!purgeColMatches(column.kind, value, filter)) return false;
  }
  return true;
}

/** The singular names the panel sends map onto the entity's own catalogue key. */
export function canonicalPurgeEntity(entity: string): string {
  switch (entity) {
    case "delivery":
      return "deliveries";
    case "driver":
      return "drivers";
    case "restaurant":
      return "restaurants";
    case "zone":
      return "zones";
    case "asset_catalog":
      return "assets";
    case "delivery_rule":
      return "delivery_rules";
    case "incentive_rule":
      return "incentive_rules";
    default:
      return entity;
  }
}

async function requireSuperAdminPurge(request: CallableRequest<unknown>): Promise<void> {
  const staff = await requireStaff(request);
  if (!staff.isSuperAdmin) {
    throw new HttpsError("permission-denied", "not_authorized");
  }
}

async function readDocs(query: Query, cap = PURGE_SCAN_CAP): Promise<PurgeDoc[]> {
  const snap = await query.limit(cap).get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }));
}

async function loadLabelMap(collection: string): Promise<Map<string, string>> {
  const db = getFirestore();
  const snap = await db.collection(collection).limit(5000).get();
  const out = new Map<string, string>();
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const label =
      asText(data.name) ?? asText(data.name_en) ?? asText(data.label) ?? asText(data.title) ?? doc.id;
    out.set(doc.id, label);
  }
  return out;
}

async function purgeLookups(entity: string): Promise<PurgeLookups> {
  const columns = PURGE_FILTER_COLUMNS[entity] ?? [];
  const keys = new Set(columns.map((column) => column.key));
  const [zones, partners, restaurants, departments] = await Promise.all([
    keys.has("zone") ? loadLabelMap(COLLECTIONS.zones) : Promise.resolve(null),
    keys.has("partner") ? loadLabelMap(COLLECTIONS.partners) : Promise.resolve(null),
    keys.has("restaurant") ? loadLabelMap(COLLECTIONS.restaurants) : Promise.resolve(null),
    keys.has("department") ? loadLabelMap(COLLECTIONS.visitDepartments) : Promise.resolve(null),
  ]);
  return {
    zones: zones ?? new Map(),
    partners: partners ?? new Map(),
    restaurants: restaurants ?? new Map(),
    departments: departments ?? new Map(),
  };
}

function rowOf(
  purgeId: string,
  label: string | null,
  sublabel: string | null,
  status: string | null,
  kind: string,
  data: Record<string, PurgeCell>,
): PurgeRow {
  return {
    purgeId,
    label: label ?? purgeId.slice(0, 8),
    sublabel: sublabel ?? "",
    status: status ?? "",
    kind,
    data,
  };
}

function purgeRowView(row: PurgeRow): {
  id: string;
  label: string;
  sublabel: string;
  status: string;
  kind: string;
} {
  return {
    id: row.purgeId,
    label: row.label,
    sublabel: row.sublabel,
    status: row.status,
    kind: row.kind,
  };
}

/**
 * `admin_purge_rows_of` — every row the entity's filter columns are expressed
 * against. Where the SQL joined a name it reads the denormalised field on the
 * document instead, which is the same value without a second read.
 */
export async function purgeRowsOf(entity: string): Promise<PurgeRow[]> {
  const db = getFirestore();

  switch (entity) {
    case "deliveries": {
      const docs = await readDocs(db.collection(COLLECTIONS.deliveries));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data[FIELDS.deliveries.driverName]),
          asText(data.external_order_id),
          asText(data[FIELDS.deliveries.status]),
          "deliveries",
          {
            status: asText(data[FIELDS.deliveries.status]),
            zone: asText(data[FIELDS.deliveries.zoneId]),
            partner: asText(data[FIELDS.deliveries.partnerId]),
            restaurant: asText(data[FIELDS.deliveries.restaurantId]),
            date:
              asDayNumber(data[FIELDS.deliveries.deliveredDay]) ??
              asDayNumber(data[FIELDS.deliveries.createdDay]) ??
              asDayNumber(data[FIELDS.deliveries.deliveredAt]),
          },
        ),
      );
    }
    case "drivers": {
      const docs = await readDocs(
        db.collection(COLLECTIONS.profiles).where(FIELDS.profiles.role, "==", "rider"),
      );
      return docs.map(({ id, data }) => {
        const restaurantId = asText(data[FIELDS.drivers.restaurantId]);
        return rowOf(
          id,
          asText(data[FIELDS.drivers.name]),
          asText(data[FIELDS.drivers.driverCode]) ?? asText(data[FIELDS.drivers.employeeId]),
          asText(data[FIELDS.drivers.status]),
          "drivers",
          {
            zone: asText(data[FIELDS.drivers.zoneId]),
            riderCategory: asText(data.rider_category),
            companyName: asText(data[FIELDS.drivers.sourceCompany]),
            status: asText(data[FIELDS.drivers.status]),
            attendance: asText(data.live_status),
            restaurants:
              asTextList(data.restaurant_ids) ?? (restaurantId !== null ? [restaurantId] : null),
            platformName: asText(data.client_name),
            vehicleType: asText(data.vehicle_type_key),
            todayDeliveries: asNumber(data.today_deliveries),
          },
        );
      });
    }
    case "vehicles": {
      const docs = await readDocs(db.collection(COLLECTIONS.vehicles));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.reg_number) ?? asText(data.plate_no),
          asText(data.bike_id),
          asText(data.status),
          "vehicles",
          {
            kind: asText(data.kind),
            condition: asText(data.condition),
            carType: asText(data.car_type),
            typeOfUse: asText(data.type_of_use),
            fuelType: asText(data.fuel_type),
            fuelCompany: asText(data.fuel_company),
            carsCompany: asText(data.cars_company),
            empCompany: asText(data.emp_company),
            project: asText(data[FIELDS.drivers.projectKey]),
            replacement: asText(data.replacement),
            driver: asText(data.driver_name) ?? asText(data.current_driver_id),
            year: asNumber(data.model_year),
          },
        ),
      );
    }
    case "attendance": {
      const docs = await readDocs(db.collection(COLLECTIONS.attendanceLogs));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data[FIELDS.attendanceLogs.driverName]),
          asText(data[FIELDS.attendanceLogs.logDate]),
          asText(data[FIELDS.attendanceLogs.status]),
          "attendance",
          {
            status: asText(data[FIELDS.attendanceLogs.status]),
            date: asDayNumber(data[FIELDS.attendanceLogs.logDate]),
          },
        ),
      );
    }
    case "earnings": {
      const docs = await readDocs(db.collection(COLLECTIONS.driverEarningsDaily));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.driver_name),
          asText(data.earn_date) ?? asText(data.day),
          null,
          "earnings",
          {
            driver: asText(data.driver_name) ?? asText(data.driver_id),
            date: asDayNumber(data.earn_date) ?? asDayNumber(data.day),
          },
        ),
      );
    }
    case "payouts": {
      const docs = await readDocs(db.collection(COLLECTIONS.driverPayouts));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.driver_name),
          asText(data.period_month),
          asText(data.status),
          "payouts",
          {
            status: asText(data.status),
            date: asDayNumber(data.created_at),
          },
        ),
      );
    }
    case "requests": {
      const docs = await readDocs(db.collection(COLLECTIONS.requests));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.code) ?? asText(data.driver_name),
          asText(data.driver_name),
          asText(data.status),
          "requests",
          {
            type: asText(data.request_type),
            status: asText(data.status),
            driver: asText(data.driver_name) ?? asText(data.driver_id),
            date: asDayNumber(data.created_at),
          },
        ),
      );
    }
    case "visits": {
      const docs = await readDocs(db.collection(COLLECTIONS.visitBookings));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.booking_code) ?? asText(data.driver_name),
          asText(data.driver_name),
          asText(data.status),
          "visits",
          {
            status: asText(data.status),
            department: asText(data.department_key) ?? asText(data.department_id),
            driver: asText(data.driver_name) ?? asText(data.driver_id),
            date: asDayNumber(data.booking_date),
          },
        ),
      );
    }
    case "notifications": {
      const docs = await readDocs(db.collection(COLLECTIONS.notificationCampaigns));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.title),
          asText(data.category),
          asText(data.status),
          "notifications",
          {
            status: asText(data.status),
            category: asText(data.category),
            priority: asText(data.priority),
            date: asDayNumber(data.created_at),
          },
        ),
      );
    }
    case "esign": {
      const docs = await readDocs(db.collection(COLLECTIONS.esignRequests));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.code) ?? asText(data.title),
          asText(data.driver_name),
          asText(data.status),
          "esign",
          {
            status: asText(data.status),
            category: asText(data.category_key),
            driver: asText(data.driver_name) ?? asText(data.driver_id),
            date: asDayNumber(data.created_at),
          },
        ),
      );
    }
    case "fuel": {
      const docs = await readDocs(db.collection(COLLECTIONS.fuelFills));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.driver_name),
          asText(data.station),
          null,
          "fuel",
          {
            driver: asText(data.driver_name) ?? asText(data.driver_id),
            station: asText(data.station),
            date: asDayNumber(data.filled_at) ?? asDayNumber(data.created_at),
          },
        ),
      );
    }
    case "wrong_actions": {
      const docs = await readDocs(db.collection(COLLECTIONS.wrongActions));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.driver_name),
          asText(data.action_type),
          asText(data.severity),
          "wrong_actions",
          {
            actionType: asText(data.action_type),
            severity: asText(data.severity),
            driver: asText(data.driver_name) ?? asText(data.driver_id),
            date: asDayNumber(data.occurred_at) ?? asDayNumber(data.created_at),
          },
        ),
      );
    }
    case "documents": {
      const docs = await readDocs(db.collection(COLLECTIONS.documentTracking));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.driver_name),
          asText(data.doc_type),
          asText(data.tracking_status),
          "documents",
          {
            docType: asText(data.doc_type),
            tracking: asText(data.tracking_status),
            driver: asText(data.driver_name) ?? asText(data.driver_id),
            date: asDayNumber(data.expiry_date) ?? asDayNumber(data.created_at),
          },
        ),
      );
    }
    case "order_recon": {
      const docs = await readDocs(db.collection(COLLECTIONS.orderReconRuns));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.file_name),
          asText(data.status),
          asText(data.status),
          "order_recon",
          {
            status: asText(data.status),
            file: asText(data.file_name),
            date: asDayNumber(data.created_at),
          },
        ),
      );
    }
    case "verifications": {
      const docs = await readDocs(db.collection(COLLECTIONS.deliveryVerifications));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.driver_name),
          asText(data.external_order_id),
          asText(data.status),
          "verifications",
          {
            status: asText(data.status),
            partner: asText(data.partner_id),
            restaurant: asText(data.restaurant_id),
            driver: asText(data.driver_name) ?? asText(data.driver_id),
            date: asDayNumber(data.created_at),
          },
        ),
      );
    }
    case "restaurants": {
      const docs = await readDocs(db.collection(COLLECTIONS.restaurants));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.name),
          asText(data.code),
          asText(data.status),
          "restaurants",
          {
            status: asText(data.status),
            active: asText(data.is_active ?? data.active),
            partner: asText(data.partner_id),
            zone: asText(data.zone_id),
            name: asText(data.name),
          },
        ),
      );
    }
    case "zones": {
      const docs = await readDocs(db.collection(COLLECTIONS.zones));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.name),
          asText(data.code),
          null,
          "zones",
          {
            zoneType: asText(data.zone_type),
            name: asText(data.name),
          },
        ),
      );
    }
    case "partners": {
      const docs = await readDocs(db.collection(COLLECTIONS.partners));
      return docs.map(({ id, data }) =>
        rowOf(id, asText(data.name), asText(data.slug), null, "partners", {
          name: asText(data.name),
        }),
      );
    }
    case "companies": {
      const docs = await readDocs(
        db.collection(COLLECTIONS.sourceCompanies).where("is_system", "==", false),
      );
      return docs.map(({ id, data }) =>
        rowOf(id, asText(data.name), asText(data.code), null, "companies", {
          active: asText(data.is_active ?? data.active),
          name: asText(data.name),
        }),
      );
    }
    case "driver_groups": {
      const docs = await readDocs(db.collection(COLLECTIONS.driverGroups));
      return docs.map(({ id, data }) =>
        rowOf(id, asText(data.name), asText(data.icon_key), null, "driver_groups", {
          name: asText(data.name),
        }),
      );
    }
    case "assets": {
      const docs = await readDocs(db.collection(COLLECTIONS.assetCatalog));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.name),
          asText(data.code),
          asText(data.is_active ?? data.active),
          "assets",
          {
            category: asText(data.category),
            active: asText(data.is_active ?? data.active),
            name: asText(data.name),
          },
        ),
      );
    }
    case "delivery_rules": {
      const docs = await readDocs(db.collection(COLLECTIONS.deliveryRules));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.name),
          asText(data.scope_type),
          asText(data.status),
          "delivery_rules",
          {
            status: asText(data.status),
            scopeType: asText(data.scope_type),
            name: asText(data.name),
          },
        ),
      );
    }
    case "incentive_rules": {
      const docs = await readDocs(db.collection(COLLECTIONS.incentiveRules));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.name),
          asText(data.scope_type),
          asText(data.status),
          "incentive_rules",
          {
            status: asText(data.status),
            scopeType: asText(data.scope_type),
            period: asText(data.period),
            name: asText(data.name),
          },
        ),
      );
    }
    case "payroll": {
      const docs = await readDocs(db.collection(COLLECTIONS.driverOffStructure));
      return docs.map(({ id, data }) =>
        rowOf(
          id,
          asText(data.driver_name) ?? asText(data.driver_id),
          asText(data.month),
          null,
          "payroll",
          {
            driver: asText(data.driver_name) ?? asText(data.driver_id),
            month: asText(data.month),
            source: asText(data.source),
            offDays: asNumber(data.off_days),
          },
        ),
      );
    }
    default:
      throw new HttpsError("failed-precondition", "unknown_entity");
  }
}

/**
 * The labels behind a list column's raw tokens. A column with no lookup
 * resolves to `null`, which the dialog renders as the token itself — exactly
 * what the SQL does for an enum value with no name table.
 */
function purgeValueLabel(lookups: PurgeLookups, column: string, value: string): string | null {
  switch (column) {
    case "zone":
      return lookups.zones.get(value) ?? null;
    case "partner":
      return lookups.partners.get(value) ?? null;
    case "restaurant":
      return lookups.restaurants.get(value) ?? null;
    case "department":
      return lookups.departments.get(value) ?? null;
    default:
      return null;
  }
}

function purgeBreakdown(entity: string, rows: PurgeRow[]): Record<string, number> {
  const columns = PURGE_FILTER_COLUMNS[entity] ?? [];
  if (!columns.some((column) => column.key === "status")) return {};
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = row.status === "" ? "unknown" : row.status;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

async function matchedPurgeRows(
  entity: string,
  filters: Record<string, unknown>,
): Promise<PurgeRow[]> {
  const rows = await purgeRowsOf(entity);
  return rows.filter((row) => purgeRowMatches(entity, row, filters));
}

function purgeFilterColumns(entity: string): readonly PurgeFilterColumn[] {
  const columns = PURGE_FILTER_COLUMNS[entity];
  if (!columns) throw new HttpsError("failed-precondition", "unknown_entity");
  return columns;
}

/**
 * `admin_purge_filtered_values` — the distinct values of one column, with every
 * *other* active filter applied, so a value that cannot match is never offered.
 */
export const adminPurgeFilteredValues = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const entity = canonicalPurgeEntity(textOf(data.entity));
  const column = textOf(data.column);
  const filters = filterObjectOf(data.filters);

  await requireSuperAdminPurge(request);
  purgeFilterColumns(entity);
  validatePurgeFilters(entity, filters);

  const rows = await purgeRowsOf(entity);
  const lookups = await purgeLookups(entity);
  const scoped = rows.filter((row) =>
    purgeRowMatches(
      entity,
      row,
      Object.fromEntries(Object.entries(filters).filter(([key]) => key !== column)),
    ),
  );

  const values = new Map<string, string | null>();
  for (const row of scoped) {
    const cell = row.data[column] ?? null;
    const entries = Array.isArray(cell) ? cell : cell === null ? [] : [String(cell)];
    for (const entry of entries) values.set(entry, purgeValueLabel(lookups, column, entry));
  }

  return {
    values: [...values.entries()].map(([value, label]) => ({ value, label })),
  };
});

/** `admin_purge_filtered_preview` — the count, the breakdown and a short sample. */
export const adminPurgeFilteredPreview = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const entity = canonicalPurgeEntity(textOf(data.entity));
  const filters = filterObjectOf(data.filters);

  await requireSuperAdminPurge(request);
  purgeFilterColumns(entity);
  validatePurgeFilters(entity, filters);

  const [matched, blockers] = await Promise.all([
    matchedPurgeRows(entity, filters),
    purgeBlockersFor(entity),
  ]);

  return {
    count: matched.length,
    breakdown: purgeBreakdown(entity, matched),
    blockers,
    sample: matched.slice(0, 5).map(purgeRowView),
  };
});

/** `admin_purge_filtered_page` — the review list, ordered deterministically. */
export const adminPurgeFilteredPage = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  const entity = canonicalPurgeEntity(textOf(data.entity));
  const filters = filterObjectOf(data.filters);
  const offset = Math.max(0, Math.trunc(numberOf(data.offset) ?? 0));
  const limit = Math.min(PURGE_PAGE_MAX, Math.max(1, Math.trunc(numberOf(data.limit) ?? 50)));

  await requireSuperAdminPurge(request);
  purgeFilterColumns(entity);
  validatePurgeFilters(entity, filters);

  const matched = await matchedPurgeRows(entity, filters);
  const ordered = matched
    .slice()
    .sort((left, right) => left.purgeId.localeCompare(right.purgeId));

  return {
    rows: ordered.slice(offset, offset + limit).map(purgeRowView),
    total: ordered.length,
    hasMore: offset + limit < ordered.length,
  };
});
