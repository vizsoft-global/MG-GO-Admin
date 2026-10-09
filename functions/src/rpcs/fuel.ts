import { onCall } from "firebase-functions/v2/https";
import { getFirestore, type Query } from "firebase-admin/firestore";
import { COLLECTIONS } from "../core/collections";
import { parseId } from "../core/query";
import { requireStaff } from "../core/staff";
import { Timestamp } from "firebase-admin/firestore";
import {
  asDate,
  loadAllDocs,
  loadDocMap,
  num,
  toRow,
  type Dict,
  type Row,
} from "./fleet";

/**
 * Timestamps become ISO strings on the wire, exactly as PostgREST serialised
 * them. `fleet.ts` keeps its own copy unexported, and reaching into that file to
 * share one four-line helper would couple two modules to a formatting decision.
 */
function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = Number((value as { seconds: unknown }).seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

/**
 * `fuel_fill_attachments` is a SQL table name with no entry in `COLLECTIONS`,
 * because it is a child of the fill and is only ever read with it. Declaring it
 * here rather than widening the shared registry keeps the typo-safety of one
 * home per name without forcing a collection that is only used by this file
 * into every other module's import.
 */
const FUEL_FILL_ATTACHMENTS = "fuel_fill_attachments";

/** `in` filters are chunked at 30 — Firestore's documented ceiling per query. */
const IN_CHUNK = 30;

/**
 * Upper bound on the rows the in-memory path scans.
 *
 * The SQL counted and paged in Postgres, so a search/project/type filter could
 * always reach the true total. Firestore cannot: `project_key` and
 * `vehicle_type_key` live on the joined driver and vehicle, so a query cannot
 * filter on them without a denormalised copy. Rather than silently return a
 * short total, this ceiling is stated and the same one is reported back, and the
 * unfiltered path — which is the `/fuel` default and the whole per-driver page —
 * uses a `count()` aggregation and exact `offset`/`limit` instead, so the common
 * case is neither capped nor approximate.
 */
const FILTERED_SCAN_CEILING = 5000;

function pick(data: Dict, ...keys: string[]): unknown {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) return data[key];
  }
  return undefined;
}

/** A Kuwait calendar date (`YYYY-MM-DD`) as the inclusive start-of-day instant. */
function kuwaitStartOfDay(day: string): Date {
  // Asia/Kuwait is a fixed UTC+3 with no DST, so the offset is arithmetic rather
  // than a timezone lookup — the same assumption the SQL made.
  return new Date(`${day}T00:00:00.000+03:00`);
}

function isoDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

async function loadAttachmentsByFill(fillIds: readonly string[]): Promise<Map<string, Dict[]>> {
  const out = new Map<string, Dict[]>();
  const unique = Array.from(new Set(fillIds.filter((id) => id.length > 0)));
  if (!unique.length) return out;

  const db = getFirestore();
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += IN_CHUNK) {
    chunks.push(unique.slice(index, index + IN_CHUNK));
  }

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      db.collection(FUEL_FILL_ATTACHMENTS).where("fill_id", "in", chunk).get(),
    ),
  );

  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const row = toRow(doc.id, doc.data() as Dict);
      const fillId = parseId(row.fill_id);
      if (!fillId) continue;
      const list = out.get(fillId) ?? [];
      list.push(row);
      out.set(fillId, list);
    }
  }
  return out;
}

function attachmentJson(rows: Dict[]): Dict[] {
  return rows
    .map((row) => ({
      kind: (row.kind as string | null) ?? null,
      title: (row.title as string | null) ?? null,
      file_name: (row.file_name as string | null) ?? null,
      storage_key: (row.storage_key as string | null) ?? null,
      captured_at: iso(row.captured_at),
      source: (row.source as string | null) ?? null,
    }))
    .sort((a, b) => (a.kind ?? "").localeCompare(b.kind ?? ""));
}

type JoinedRow = {
  fill: Row;
  driver: Row;
  vehicle: Row;
  profile: Row;
  ownerCompany: Row | undefined;
  employeeCompany: Row | undefined;
  zone: Row | undefined;
  attachments: Dict[];
};

function nameOf(row: Row | undefined): string | null {
  if (!row) return null;
  const name = row.name;
  return typeof name === "string" && name.trim().length ? name.trim() : null;
}

function fullNameOf(row: Row | undefined): string {
  if (!row) return "";
  const value = row.full_name;
  return typeof value === "string" ? value.trim() : "";
}

function toListItem(joined: JoinedRow, filledAt: Date | null): Dict {
  const { fill, driver, vehicle, profile, ownerCompany, employeeCompany, zone } = joined;
  const cost = num(fill.cost_kwd);
  const limit = num(vehicle.fuel_monthly_limit_kwd);
  const driverName = fullNameOf(profile);

  return {
    id: fill.id,
    filled_at: filledAt ? filledAt.toISOString() : null,
    litres: num(fill.litres),
    cost_kwd: cost,
    station_name: (fill.station_name as string | null) ?? null,
    lat: num(fill.lat),
    lng: num(fill.lng),
    driver_id: (fill.driver_id as string | null) ?? null,
    driver_name: driverName.length ? driverName : ((driver.driver_code as string | null) ?? null),
    driver_code: (driver.driver_code as string | null) ?? null,
    employee_id: (driver.employee_id as string | null) ?? null,
    project_key: (driver.project_key as string | null) ?? null,
    accommodation: (driver.accommodation as string | null) ?? null,
    vehicle_id: (fill.vehicle_id as string | null) ?? null,
    plate: (vehicle.reg_number as string | null) ?? null,
    kind: (vehicle.vehicle_type_key as string | null) ?? null,
    model: (vehicle.model as string | null) ?? null,
    make: (vehicle.make as string | null) ?? null,
    fuel_type: (vehicle.fuel_type as string | null) ?? null,
    fuel_company: (vehicle.fuel_company as string | null) ?? null,
    chip_no: (vehicle.chip_no as string | null) ?? null,
    fuel_monthly_limit_kwd: limit,
    vehicle_company: nameOf(ownerCompany),
    employee_company: nameOf(employeeCompany),
    zone_name: nameOf(zone),
    utilisation_pct:
      limit === null || limit === 0 || cost === null
        ? null
        : Math.round((cost / limit) * 1000) / 10,
    attachments: attachmentJson(joined.attachments),
  };
}

/**
 * `admin_list_fuel_fills`.
 *
 * Three of the SQL predicates are unindexable in Firestore — the search spans
 * the profile, driver and vehicle, and the project/vehicle-type filters live on
 * joined documents — so the shape here is deliberately split: an exact query
 * path for the unfiltered list and the per-driver page, and one bounded
 * in-memory scan only when a joined predicate is actually asked for.
 */
export const adminListFuelFills = onCall(async (request) => {
  await requireStaff(request, "fuel.view");

  const data = (request.data ?? {}) as Dict;
  const from = isoDay(pick(data, "from", "p_from"));
  const to = isoDay(pick(data, "to", "p_to"));
  const searchRaw = pick(data, "search", "p_search");
  const search = typeof searchRaw === "string" && searchRaw.trim().length ? searchRaw.trim() : null;
  const projectKey = parseId(pick(data, "projectKey", "project_key", "p_project_key"));
  const vehicleTypeKey = parseId(
    pick(data, "vehicleTypeKey", "vehicle_type_key", "p_vehicle_type_key"),
  );
  const driverId = parseId(pick(data, "driverId", "driver_id", "p_driver_id"));
  const limit = Math.max(Math.trunc(num(pick(data, "limit", "p_limit")) ?? 200), 1);
  const offset = Math.max(Math.trunc(num(pick(data, "offset", "p_offset")) ?? 0), 0);

  const db = getFirestore();
  let base: Query = db.collection(COLLECTIONS.fuelFills);
  if (from) base = base.where("filled_at", ">=", kuwaitStartOfDay(from));
  if (to) {
    // `p_to` is inclusive in the SQL, so the upper bound is the next day's start.
    base = base.where("filled_at", "<", new Date(kuwaitStartOfDay(to).getTime() + 86_400_000));
  }
  if (driverId) base = base.where("driver_id", "==", driverId);

  const needsJoinedFilter = Boolean(search || projectKey || vehicleTypeKey);

  const [{ total, rows }, zoneDocs, partnerDocs] = await Promise.all([
    needsJoinedFilter
      ? scanFiltered(base, { search, projectKey, vehicleTypeKey, limit, offset })
      : pageExact(base, limit, offset),
    loadAllDocs(COLLECTIONS.zones),
    // Partners are two different lookups against one collection (vehicle owner
    // and the rider's employing partner), so the whole collection is loaded once
    // rather than read twice per row.
    loadAllDocs(COLLECTIONS.partners),
  ]);

  const fillIds = rows.map((row) => row.id);
  const driverIds = rows
    .map((row) => parseId(row.driver_id))
    .filter((id): id is string => id !== null);
  const vehicleIds = rows
    .map((row) => parseId(row.vehicle_id))
    .filter((id): id is string => id !== null);

  const [profileById, driverById, vehicleById, attachments] = await Promise.all([
    loadDocMap(COLLECTIONS.profiles, driverIds),
    loadDocMap(COLLECTIONS.drivers, driverIds),
    loadDocMap(COLLECTIONS.vehicles, vehicleIds),
    loadAttachmentsByFill(fillIds),
  ]);

  const zoneById = new Map(zoneDocs.map((doc) => [doc.id, doc] as const));
  const partnerById = new Map(partnerDocs.map((doc) => [doc.id, doc] as const));

  const out = rows.map((fill) => {
    const driverIdValue = parseId(fill.driver_id);
    const vehicleIdValue = parseId(fill.vehicle_id);
    const driver = (driverIdValue ? driverById.get(driverIdValue) : undefined) ?? ({} as Row);
    const vehicle = (vehicleIdValue ? vehicleById.get(vehicleIdValue) : undefined) ?? ({} as Row);
    const profile = (driverIdValue ? profileById.get(driverIdValue) : undefined) ?? ({} as Row);
    const ownerId = parseId(vehicle.owner_partner_id);
    const employeeId = parseId(driver.partner_id);
    const zoneId = parseId(driver.zone_id);
    return toListItem(
      {
        fill,
        driver,
        vehicle,
        profile,
        ownerCompany: ownerId ? partnerById.get(ownerId) : undefined,
        employeeCompany: employeeId ? partnerById.get(employeeId) : undefined,
        zone: zoneId ? zoneById.get(zoneId) : undefined,
        attachments: attachments.get(fill.id) ?? [],
      },
      asDate(fill.filled_at),
    );
  });

  return { ok: true, total, rows: out };
});

async function pageExact(
  base: Query,
  limit: number,
  offset: number,
): Promise<{ total: number; rows: Row[] }> {
  const [countSnap, snap] = await Promise.all([
    base.count().get(),
    base.orderBy("filled_at", "desc").offset(offset).limit(limit).get(),
  ]);
  return {
    total: countSnap.data().count,
    rows: snap.docs.map((doc) => toRow(doc.id, doc.data() as Dict)),
  };
}

async function scanFiltered(
  base: Query,
  filters: {
    search: string | null;
    projectKey: string | null;
    vehicleTypeKey: string | null;
    limit: number;
    offset: number;
  },
): Promise<{ total: number; rows: Row[] }> {
  const snap = await base
    .orderBy("filled_at", "desc")
    .limit(FILTERED_SCAN_CEILING)
    .get();
  const rows = snap.docs.map((doc) => toRow(doc.id, doc.data() as Dict));

  const driverIds = Array.from(
    new Set(rows.map((row) => parseId(row.driver_id)).filter((id): id is string => id !== null)),
  );
  const vehicleIds = Array.from(
    new Set(rows.map((row) => parseId(row.vehicle_id)).filter((id): id is string => id !== null)),
  );
  const [driverById, vehicleById, profileById] = await Promise.all([
    loadDocMap(COLLECTIONS.drivers, driverIds),
    loadDocMap(COLLECTIONS.vehicles, vehicleIds),
    loadDocMap(COLLECTIONS.profiles, driverIds),
  ]);

  const needle = filters.search ? filters.search.toLowerCase() : null;

  const matched = rows.filter((fill) => {
    const driverId = parseId(fill.driver_id);
    const vehicleId = parseId(fill.vehicle_id);
    const driver = driverId ? driverById.get(driverId) : undefined;
    const vehicle = vehicleId ? vehicleById.get(vehicleId) : undefined;
    const profile = driverId ? profileById.get(driverId) : undefined;

    if (filters.projectKey && parseId(driver?.project_key) !== filters.projectKey) return false;
    if (
      filters.vehicleTypeKey &&
      parseId(vehicle?.vehicle_type_key) !== filters.vehicleTypeKey
    ) {
      return false;
    }
    if (!needle) return true;

    const haystack = [
      profile?.full_name,
      driver?.driver_code,
      driver?.employee_id,
      vehicle?.reg_number,
    ];
    return haystack.some(
      (value) => typeof value === "string" && value.toLowerCase().includes(needle),
    );
  });

  return {
    total: matched.length,
    rows: matched.slice(filters.offset, filters.offset + filters.limit),
  };
}

const TRANSFER_TYPES = new Set(["cash", "salary"]);

/**
 * `admin_set_fuel_transfer_type`.
 *
 * The payout method is a standing instruction on the request, not part of the
 * decision, so it stays writable after approval — and `null` stays legal because
 * a choice made in error has to be clearable. `closed` is the only status that
 * refuses, since a closed request is archived; `rejected` deliberately still
 * accepts a correction.
 */
export const adminSetFuelTransferType = onCall(async (request) => {
  const staff = await requireStaff(request);
  if (!staff.permissionSlugs.has("requests.approve") && !staff.permissionSlugs.has("requests.manage")) {
    return { ok: false, error: "not_authorized" };
  }

  const data = (request.data ?? {}) as Dict;
  const requestId = parseId(pick(data, "requestId", "request_id", "p_request_id"));
  if (!requestId) return { ok: false, error: "not_found" };

  const raw = pick(data, "transferType", "transfer_type", "p_transfer_type");
  const value =
    typeof raw === "string" && raw.trim().length ? raw.trim().toLowerCase() : null;
  if (value !== null && !TRANSFER_TYPES.has(value)) {
    return { ok: false, error: "invalid_transfer_type" };
  }

  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.requests).doc(requestId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, error: "not_found" };

    const row = snap.data() as Dict;
    if (row.request_type !== "fuel") return { ok: false, error: "not_fuel_request" };
    if (row.status === "closed") return { ok: false, error: "already_closed" };

    tx.update(ref, { fuel_transfer_type: value, updated_at: new Date() });
    return { ok: true, fuel_transfer_type: value };
  });
});
