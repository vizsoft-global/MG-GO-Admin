/**
 * Accident Management — reads.
 *
 * A plain server module (no `"use server"`), so a **server component** can call
 * these directly. A `"use server"` module may only be imported by a client
 * component, and calling an action from an RSC breaks client-side navigation with
 * "An unexpected response was received from the server" — the same constraint
 * `service-reads.ts` documents.
 */
import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { parseAccidentRow, sortAccidents, type AccidentVehicleSnapshot } from "./accident-model";
import { ACCIDENT_REFERENCE_COUNTER } from "./accident-reference";
import type {
  AccidentAttachmentMeta,
  AccidentRow,
  AccidentVehicleOption,
} from "./accident-types";

export const VEHICLE_ACCIDENTS = "vehicle_accidents";
export const STORAGE_UPLOADS = "storage_uploads";
const ACCIDENT_CAP = 3000;
const IN_FILTER_LIMIT = 30;

export type Row = Record<string, unknown> & { id: string };

function asRow(id: string, data: unknown): Row {
  const plain = (value: unknown): unknown => {
    if (value == null || typeof value !== "object") return value;
    if (value instanceof Date) return value.toISOString();
    if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
      return (value as { toDate: () => Date }).toDate().toISOString();
    }
    if (Array.isArray(value)) return value.map(plain);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = plain(child);
    }
    return out;
  };
  return { id, ...((plain(data ?? {}) as Record<string, unknown>) ?? {}) };
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function openDb() {
  const db = await staffDb();
  if (!db) throw new Error("not_configured");
  return db;
}

async function allRows(collection: string): Promise<Row[]> {
  const db = await openDb();
  const snap = await db.collection(collection).get();
  return snap.docs.map((doc) => asRow(doc.id, doc.data()));
}

export async function requireAccidents(permission: "vehicles.view" | "vehicles.manage") {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, permission, session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function listAccidents(): Promise<AccidentRow[]> {
  const auth = await requireAccidents("vehicles.view");
  if ("error" in auth) return [];
  const rows = await allRows(VEHICLE_ACCIDENTS);
  void logAdminRead("vehicle_accidents", "/fleet/accident");
  return sortAccidents(rows.map((row) => parseAccidentRow(row.id, row))).slice(0, ACCIDENT_CAP);
}

export async function getAccident(id: string): Promise<AccidentRow | null> {
  const auth = await requireAccidents("vehicles.view");
  if ("error" in auth) return null;
  if (!id) return null;
  const db = await openDb();
  const snap = await db.collection(VEHICLE_ACCIDENTS).doc(id).get();
  if (!snap.exists) return null;
  return parseAccidentRow(snap.id, snap.data() as Record<string, unknown>);
}

/** `vehicles/{id}` → plate, using the two columns the fleet form writes. */
export function plateOf(row: Row): string {
  return str(row.reg_number) || str(row.bike_id) || row.id;
}

async function driverByVehicle(): Promise<
  Map<string, { id: string; name: string | null; employeeId: string | null; code: string | null }>
> {
  const db = await openDb();
  const drivers = await db.collection(COLLECTIONS.drivers).get();
  const byVehicle = new Map<
    string,
    { id: string; name: string | null; employeeId: string | null; code: string | null }
  >();
  const ids: string[] = [];
  for (const doc of drivers.docs) {
    const row = doc.data() as Record<string, unknown>;
    if (row.archived_at) continue;
    const vehicleId = str(row.vehicle_id);
    if (!vehicleId) continue;
    byVehicle.set(vehicleId, {
      id: doc.id,
      name: null,
      employeeId: str(row.employee_id) || null,
      code: str(row.driver_code) || null,
    });
    ids.push(doc.id);
  }
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map((id) => db.collection(COLLECTIONS.profiles).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    const names = new Map<string, string | null>();
    for (const snap of snaps) {
      if (!snap.exists) continue;
      names.set(snap.id, str((snap.data() as Record<string, unknown>).full_name) || null);
    }
    for (const entry of byVehicle.values()) {
      if (names.has(entry.id)) entry.name = names.get(entry.id) ?? null;
    }
  }
  return byVehicle;
}

export async function listAccidentVehicles(): Promise<AccidentVehicleOption[]> {
  const auth = await requireAccidents("vehicles.view");
  if ("error" in auth) return [];
  const [vehicles, drivers, companies] = await Promise.all([
    allRows(COLLECTIONS.vehicles),
    driverByVehicle(),
    allRows(COLLECTIONS.vehicleCompanies),
  ]);
  const companyNames = new Map<string, string>();
  for (const row of companies) {
    companyNames.set(str(row.key) || row.id, str(row.label_en) || str(row.key) || row.id);
  }
  return vehicles
    .filter((row) => !row.archived_at)
    .map((row) => {
      const driver = drivers.get(row.id);
      const companyId = str(row.company_id);
      return {
        id: row.id,
        plate: plateOf(row),
        model: str(row.model) || null,
        model_year: num(row.model_year),
        company_name: companyId ? companyNames.get(companyId) ?? null : null,
        driver_id: driver?.id ?? null,
        driver_name: driver?.name ?? null,
        employee_id: driver?.employeeId ?? null,
      };
    })
    .sort((a, b) => a.plate.localeCompare(b.plate));
}


export function sessionName(session: { profile?: { full_name?: string | null } } | null): string | null {
  const name = session?.profile?.full_name;
  return name ? String(name) : null;
}

/**
 * The frozen vehicle + driver values a case keeps, so a later plate change or a
 * rider handover cannot rewrite history.
 */
export async function vehicleSnapshotFor(vehicleId: string): Promise<AccidentVehicleSnapshot | null> {
  if (!vehicleId) return null;
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.vehicles).doc(vehicleId).get();
  if (!snap.exists) return null;
  const vehicle = asRow(snap.id, snap.data());
  const companyId = str(vehicle.company_id);
  let companyName: string | null = null;
  if (companyId) {
    const company = await db.collection(COLLECTIONS.vehicleCompanies).doc(companyId).get();
    if (company.exists) {
      companyName = str((company.data() as Record<string, unknown>).label_en) || companyId;
    }
  }
  const driver = (await driverByVehicle()).get(vehicleId);
  return {
    plate: plateOf(vehicle),
    company_name: companyName,
    model_year: num(vehicle.model_year),
    driver_id: driver?.id ?? null,
    driver_name: driver?.name ?? null,
    driver_code: driver?.code ?? null,
    employee_id: driver?.employeeId ?? null,
  };
}

/** Does this object key already belong to another accident? */
export async function keyClaimedByAccident(key: string, excludeId?: string): Promise<boolean> {
  const db = await openDb();
  const snap = await db
    .collection(VEHICLE_ACCIDENTS)
    .where("attachment_keys", "array-contains", key)
    .limit(5)
    .get();
  return snap.docs.some((doc) => doc.id !== excludeId);
}

/**
 * Filename / type / size for each object key, read from the upload ledger rather
 * than a HEAD per row. A key with no ledger row still renders — it just shows the
 * key, which is what the legacy single attachment always did.
 */
export async function attachmentMetaFromKeys(
  keys: readonly string[],
  fallback?: readonly AccidentAttachmentMeta[],
): Promise<AccidentAttachmentMeta[]> {
  const wanted = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  if (wanted.length === 0) return [];
  const known = new Map<string, AccidentAttachmentMeta>();
  for (const meta of fallback ?? []) known.set(meta.key, meta);
  const db = await openDb();
  for (let i = 0; i < wanted.length; i += IN_FILTER_LIMIT) {
    const slice = wanted.slice(i, i + IN_FILTER_LIMIT);
    const snap = await db
      .collection(STORAGE_UPLOADS)
      .where("object_key", "in", slice)
      .limit(IN_FILTER_LIMIT * 4)
      .get();
    for (const doc of snap.docs) {
      const row = doc.data() as Record<string, unknown>;
      const key = str(row.object_key);
      if (!key) continue;
      known.set(key, {
        key,
        file_name: str(row.file_name) || known.get(key)?.file_name || null,
        kind: str(row.entity_type) || known.get(key)?.kind || null,
        content_type: str(row.content_type) || null,
        size: num(row.size_bytes),
        uploaded_by: str(row.uploaded_by) || null,
        at: str(row.confirmed_at) || str(row.uploaded_at) || null,
      });
    }
  }
  return wanted.map(
    (key) =>
      known.get(key) ?? {
        key,
        file_name: null,
        kind: null,
        content_type: null,
        size: null,
        uploaded_by: null,
        at: null,
      },
  );
}

/** Current value of the reference counter — read only, never incremented here. */
export async function readAccidentReferenceCounter(): Promise<number> {
  const db = await openDb();
  const snap = await db.collection(COLLECTIONS.counters).doc(ACCIDENT_REFERENCE_COUNTER).get();
  const value = Number(snap.data()?.value ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

