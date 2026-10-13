import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { parseSearchTerm, type ActiveDriverHit } from "@/features/drivers/search-active-drivers";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

export const ASSISTANT_SCAN_CAP = 2000;

export function ilike(value: unknown, pattern: string): boolean {
  const text = value == null ? "" : String(value);
  let source = "";
  for (const ch of pattern) {
    if (ch === "%") source += ".*";
    else if (ch === "_") source += ".";
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i").test(text);
}

function plainValue(value: unknown): unknown {
  if (value == null) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plainValue);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.toDate === "function") {
      const date = (record as { toDate: () => Date }).toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString();
    }
    if (typeof record.latitude === "number" && typeof record.longitude === "number") {
      return { latitude: record.latitude, longitude: record.longitude };
    }
  }
  return value;
}

export function plainDoc(
  id: string,
  data: DocumentData | undefined,
): Record<string, unknown> | null {
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) out[key] = plainValue(value);
  out.id = id;
  return out;
}

export async function scanCollection(
  collection: string,
  cap = ASSISTANT_SCAN_CAP,
): Promise<Record<string, unknown>[]> {
  const db = await staffDb();
  if (!db) return [];
  const snap = await db.collection(collection).limit(cap).get();
  return snap.docs.map((doc) => plainDoc(doc.id, doc.data())!);
}

export async function docById(
  collection: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const db = await staffDb();
  if (!db || !id) return null;
  const snap = await db.collection(collection).doc(id).get();
  if (!snap.exists) return null;
  return plainDoc(snap.id, snap.data());
}

export async function rowsWhere(
  collection: string,
  field: string,
  value: unknown,
  limit = 6,
): Promise<Record<string, unknown>[]> {
  const db = await staffDb();
  if (!db) return [];
  const snap = await db.collection(collection).where(field, "==", value).limit(limit).get();
  return snap.docs.map((doc) => plainDoc(doc.id, doc.data())!);
}

export async function loadDocs(
  db: Firestore,
  collection: string,
  ids: readonly string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  for (let index = 0; index < unique.length; index += 30) {
    const refs = unique.slice(index, index + 30).map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const row = plainDoc(snap.id, snap.data());
      if (row) map.set(snap.id, row);
    }
  }
  return map;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isArchived(row: Record<string, unknown>): boolean {
  return row.archived_at != null;
}

async function resolveNamed(
  collection: string,
  nameOrId?: string | null,
): Promise<{ id?: string; name?: string }> {
  const raw = nameOrId?.trim();
  if (!raw || raw.toLowerCase() === "all") return {};
  const byId = await docById(collection, raw);
  if (byId) return { id: String(byId.id), name: text(byId.name) };
  const rows = await scanCollection(collection);
  const exact = rows.filter((row) => ilike(row.name, raw));
  if (exact.length === 1) return { id: String(exact[0]!.id), name: text(exact[0]!.name) };
  const fuzzy = rows.filter((row) => ilike(row.name, `%${raw}%`));
  if (fuzzy.length === 1) return { id: String(fuzzy[0]!.id), name: text(fuzzy[0]!.name) };
  return {};
}

export async function resolveZoneId(nameOrId?: string | null) {
  return resolveNamed(COLLECTIONS.zones, nameOrId);
}

export async function resolvePartnerId(nameOrId?: string | null) {
  return resolveNamed(COLLECTIONS.partners, nameOrId);
}

export async function resolveRestaurantId(nameOrId?: string | null) {
  return resolveNamed(COLLECTIONS.restaurants, nameOrId);
}

/**
 * Split a user-typed rider reference into an optional numeric id and a name.
 *
 * Handles the shape the UI shows on a row — `"Shambhavi Testing (10084)"` —
 * so a pasted label resolves instead of failing the whole search. A bare
 * `"10084"` is an id with no name, and `"Shambhavi Testing"` is a name with
 * no id.
 */
export function parseDriverReference(raw: string): { name: string; id?: string } {
  const cleaned = raw
    .replace(/[%(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return { name: "" };
  const trailing = cleaned.match(/^(.*?)\s*(\d{4,8})$/);
  if (trailing) {
    return { name: trailing[1]!.trim(), id: trailing[2]! };
  }
  return { name: cleaned };
}

async function driverHit(row: Record<string, unknown>): Promise<{
  id: string;
  name?: string;
  driver_code?: string;
  employee_id?: string;
}> {
  const db = await staffDb();
  const id = String(row.id);
  const profile = db ? (await loadDocs(db, COLLECTIONS.profiles, [id])).get(id) : undefined;
  const name = text(profile?.full_name).trim();
  return {
    id,
    driver_code: text(row.driver_code) || undefined,
    employee_id: text(row.employee_id) || undefined,
    name: name || undefined,
  };
}

export async function resolveDriverId(codeOrEmployeeOrName?: string | null): Promise<{
  id?: string;
  name?: string;
  driver_code?: string;
  employee_id?: string;
}> {
  const raw = codeOrEmployeeOrName?.trim();
  if (!raw) return {};
  const { name, id } = parseDriverReference(raw);

  if (id) {
    const [byCode, byEmployee] = await Promise.all([
      rowsWhere(COLLECTIONS.drivers, "driver_code", id, 2),
      rowsWhere(COLLECTIONS.drivers, "employee_id", id, 2),
    ]);
    const unique = new Map<string, Record<string, unknown>>();
    for (const row of [...byCode, ...byEmployee]) {
      if (!isArchived(row)) unique.set(String(row.id), row);
    }
    if (unique.size === 1) return driverHit([...unique.values()][0]!);
    if (!name) return {};
  }

  if (!name) return {};

  const profiles = await scanCollection(COLLECTIONS.profiles);
  const nameIds: string[] = [];
  for (const row of profiles) {
    if (!ilike(row.full_name, `%${name}%`)) continue;
    nameIds.push(String(row.id));
    if (nameIds.length === 2) break;
  }

  const intakes = await rowsWhere(COLLECTIONS.driverIntakes, "archived_at", null, ASSISTANT_SCAN_CAP);
  let intakeHits = 0;
  for (const intake of intakes) {
    if (!ilike(intake.full_name, `%${name}%`)) continue;
    const linked = text(intake.linked_profile_id);
    if (linked && !nameIds.includes(linked)) nameIds.push(linked);
    intakeHits += 1;
    if (intakeHits === 2) break;
  }

  if (nameIds.length === 0) return {};
  const db = await staffDb();
  if (!db) return {};
  const drivers = await loadDocs(db, COLLECTIONS.drivers, nameIds);
  const live = [...drivers.values()].filter((row) => !isArchived(row));
  if (live.length !== 1) return {};
  return driverHit(live[0]!);
}

export async function searchLiveDrivers(query: string, limit = 30): Promise<ActiveDriverHit[]> {
  const { name, id } = parseSearchTerm(query);
  if (!name && !id) return [];

  const db = await staffDb();
  if (!db) return [];

  const nameIds = new Set<string>();
  if (name) {
    const like = `%${name}%`;
    const profiles = await scanCollection(COLLECTIONS.profiles);
    let profileHits = 0;
    for (const row of profiles) {
      if (!ilike(row.full_name, like)) continue;
      nameIds.add(String(row.id));
      profileHits += 1;
      if (profileHits >= limit) break;
    }
    const intakes = await rowsWhere(COLLECTIONS.driverIntakes, "archived_at", null, ASSISTANT_SCAN_CAP);
    let intakeHits = 0;
    for (const row of intakes) {
      if (!ilike(row.full_name, like)) continue;
      const linked = text(row.linked_profile_id);
      if (linked) nameIds.add(linked);
      intakeHits += 1;
      if (intakeHits >= limit) break;
    }
    if (!id && nameIds.size === 0) return [];
  }

  const drivers = await rowsWhere(COLLECTIONS.drivers, "archived_at", null, ASSISTANT_SCAN_CAP);
  const matched = drivers.filter((row) => {
    const codeHit = Boolean(id) && (ilike(row.driver_code, `%${id}%`) || ilike(row.employee_id, `%${id}%`));
    const nameHit = nameIds.has(String(row.id));
    return codeHit || nameHit;
  }).slice(0, limit);

  const profiles = await loadDocs(db, COLLECTIONS.profiles, matched.map((row) => String(row.id)));
  return matched.map((row) => ({
    id: String(row.id),
    driver_code: text(row.driver_code),
    employee_id: text(row.employee_id),
    full_name: text(profiles.get(String(row.id))?.full_name).trim() || "Driver",
  }));
}
