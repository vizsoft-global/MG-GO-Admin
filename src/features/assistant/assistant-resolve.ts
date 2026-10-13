import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { requireAssistantModule } from "./assistant-gates";
import {
  docById,
  ilike,
  loadDocs,
  rowsWhere,
  scanCollection,
  searchLiveDrivers,
  ASSISTANT_SCAN_CAP,
} from "./assistant-lookups";
import {
  ASSISTANT_CANDIDATE_CAP,
  ENTITY_MODULE_PERMISSION,
  FLEET_ENTITY_ID,
  type AssistantCandidate,
  type AssistantEntityType,
  type AssistantQueryKind,
  type AssistantResolveResult,
} from "./assistant-entity";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function classifyQueryKind(query: string): AssistantQueryKind {
  const raw = query.trim();
  if (!raw) return "name";
  if (UUID_RE.test(raw)) return "id";
  if (/^\d{4}-\d{2}$/.test(raw)) return "month";
  if (raw.includes("@")) return "email";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8 && /^[+()\s.\-0-9]+$/.test(raw)) return "phone";
  if (/^\d{4,8}$/.test(raw.replace(/\s+/g, ""))) return "code";
  if (/^[A-Z]{2,}-\d+/i.test(raw) || /^\d{3,}-\d+/.test(raw)) return "ref";
  return "name";
}

export function redactedQueryMeta(query: string): {
  query_kind: AssistantQueryKind;
  query_len: number;
} {
  return { query_kind: classifyQueryKind(query), query_len: query.trim().length };
}

function labelOf(code: string | null | undefined, name: string | null | undefined, fallback: string): string {
  const bits = [code, name].filter((part) => part && part !== "—");
  return bits.length > 0 ? bits.join(" · ") : fallback;
}

function candidate(id: string, label: string, key?: string): AssistantCandidate {
  return { id, label, key };
}

export function finalizeResolve(
  hits: AssistantCandidate[],
  entity_type: AssistantEntityType,
  query_kind: AssistantQueryKind,
): AssistantResolveResult {
  const unique = new Map<string, AssistantCandidate>();
  for (const hit of hits) {
    if (hit.id && !unique.has(hit.id)) unique.set(hit.id, hit);
  }
  const list = [...unique.values()];
  if (list.length === 0) return { status: "not_found", entity_type, query_kind };
  if (list.length === 1) {
    const match = list[0]!;
    return {
      status: "ok",
      entity_type,
      match,
      query_kind,
      focus: { entity_type, id: match.id, label: match.label },
    };
  }
  return {
    status: "ambiguous",
    entity_type,
    candidates: list.slice(0, ASSISTANT_CANDIDATE_CAP),
    query_kind,
  };
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function phoneMatches(value: unknown, raw: string, digits: string, last8: string): boolean {
  const phone = asText(value);
  return phone === raw || phone === digits || (last8.length > 0 && phone.endsWith(last8));
}

async function namedDrivers(ids: string[]): Promise<AssistantCandidate[]> {
  const db = await staffDb();
  if (!db || ids.length === 0) return [];
  const drivers = await loadDocs(db, COLLECTIONS.drivers, ids);
  const profiles = await loadDocs(db, COLLECTIONS.profiles, ids);
  const hits: AssistantCandidate[] = [];
  for (const id of ids) {
    const row = drivers.get(id);
    if (!row || row.archived_at != null) continue;
    const profile = profiles.get(id);
    hits.push(
      candidate(id, labelOf(asText(row.driver_code), asText(profile?.full_name), id), asText(row.driver_code) || undefined),
    );
    if (hits.length === 6) break;
  }
  return hits;
}

async function findDrivers(query: string): Promise<AssistantCandidate[]> {
  const raw = query.trim();
  const kind = classifyQueryKind(raw);

  if (kind === "id") {
    const row = await docById(COLLECTIONS.drivers, raw);
    if (!row || row.archived_at != null) return [];
    const named = await namedDrivers([String(row.id)]);
    return named;
  }

  if (kind === "phone") {
    const digits = raw.replace(/\D/g, "");
    const last8 = digits.slice(-8);
    const profiles = await scanCollection(COLLECTIONS.profiles);
    const ids: string[] = [];
    for (const row of profiles) {
      if (!phoneMatches(row.phone, raw, digits, last8)) continue;
      ids.push(String(row.id));
      if (ids.length === 6) break;
    }
    const hits = await namedDrivers(ids);
    const intakes = (await rowsWhere(COLLECTIONS.driverIntakes, "archived_at", null, ASSISTANT_SCAN_CAP)).filter((row) =>
      phoneMatches(row.phone, raw, digits, last8),
    );
    for (const row of intakes.slice(0, 6)) {
      const linked = asText(row.linked_profile_id);
      if (!linked || hits.some((hit) => hit.id === linked)) continue;
      hits.push(
        candidate(linked, labelOf(asText(row.driver_code), asText(row.full_name), linked), asText(row.driver_code) || undefined),
      );
    }
    return hits.slice(0, 6);
  }

  if (kind === "email") {
    const profiles = await scanCollection(COLLECTIONS.profiles);
    const ids: string[] = [];
    for (const row of profiles) {
      if (!ilike(row.email, raw)) continue;
      ids.push(String(row.id));
      if (ids.length === 6) break;
    }
    if (ids.length === 0) return [];
    return namedDrivers(ids);
  }

  if (kind === "code") {
    const digits = raw.replace(/\s+/g, "");
    const [byCode, byEmployee] = await Promise.all([
      rowsWhere(COLLECTIONS.drivers, "driver_code", digits, 6),
      rowsWhere(COLLECTIONS.drivers, "employee_id", digits, 6),
    ]);
    const ids: string[] = [];
    for (const row of [...byCode, ...byEmployee]) {
      if (row.archived_at != null) continue;
      if (!ids.includes(String(row.id))) ids.push(String(row.id));
    }
    return namedDrivers(ids.slice(0, 6));
  }

  const searched = await searchLiveDrivers(raw, 6);
  return searched.map((row) => candidate(row.id, labelOf(row.driver_code, row.full_name, row.id), row.driver_code));
}

const NAMED_COLLECTIONS = {
  zones: COLLECTIONS.zones,
  partners: COLLECTIONS.partners,
  restaurants: COLLECTIONS.restaurants,
} as const;

function namedHit(row: Record<string, unknown>, key?: string): AssistantCandidate {
  const id = String(row.id);
  return candidate(id, asText(row.name) || id, key);
}

async function findNamed(
  table: keyof typeof NAMED_COLLECTIONS,
  query: string,
  extraExact?: { column: string; value: string }[],
): Promise<AssistantCandidate[]> {
  const collection = NAMED_COLLECTIONS[table];
  const raw = query.trim();
  if (UUID_RE.test(raw)) {
    const row = await docById(collection, raw);
    if (row) return [namedHit(row)];
  }
  for (const extra of extraExact ?? []) {
    const rows = await rowsWhere(collection, extra.column, extra.value, 6);
    if (rows.length > 0) return rows.map((row) => namedHit(row, extra.value));
  }
  const scanned = await scanCollection(collection);
  const exact = scanned.filter((row) => ilike(row.name, raw)).slice(0, 6);
  if (exact.length > 0) return exact.map((row) => namedHit(row));
  return scanned.filter((row) => ilike(row.name, `%${raw}%`)).slice(0, 6).map((row) => namedHit(row));
}

async function findZones(query: string): Promise<AssistantCandidate[]> {
  const raw = query.trim();
  const zoneHit = (row: Record<string, unknown>) =>
    candidate(String(row.id), labelOf(asText(row.code), asText(row.name), String(row.id)), asText(row.code) || undefined);
  if (UUID_RE.test(raw)) {
    const row = await docById(COLLECTIONS.zones, raw);
    if (row) return [zoneHit(row)];
  }
  const byCode = await rowsWhere(COLLECTIONS.zones, "code", raw, 6);
  if (byCode.length > 0) return byCode.map(zoneHit);
  const scanned = await scanCollection(COLLECTIONS.zones);
  const exact = scanned.filter((row) => ilike(row.name, raw)).slice(0, 6);
  if (exact.length > 0) return exact.map(zoneHit);
  return scanned.filter((row) => ilike(row.name, `%${raw}%`)).slice(0, 6).map(zoneHit);
}

async function findRestaurants(query: string): Promise<AssistantCandidate[]> {
  return findNamed("restaurants", query, [
    { column: "restaurant_code", value: query.trim() },
    { column: "external_merchant_id", value: query.trim() },
  ]);
}

function vehicleHit(row: Record<string, unknown>): AssistantCandidate {
  return candidate(
    String(row.id),
    labelOf(asText(row.bike_id), asText(row.reg_number), String(row.id)),
    asText(row.bike_id) || undefined,
  );
}

async function findVehicles(query: string): Promise<AssistantCandidate[]> {
  const raw = query.trim();
  if (UUID_RE.test(raw)) {
    const row = await docById(COLLECTIONS.vehicles, raw);
    if (row) return [vehicleHit(row)];
  }
  const byBike = await rowsWhere(COLLECTIONS.vehicles, "bike_id", raw, 6);
  if (byBike.length > 0) return byBike.map(vehicleHit);
  const scanned = await scanCollection(COLLECTIONS.vehicles);
  const byPlate = scanned.filter((row) => ilike(row.reg_number, raw)).slice(0, 6);
  if (byPlate.length > 0) return byPlate.map(vehicleHit);
  return scanned.filter((row) => ilike(row.reg_number, `%${raw}%`)).slice(0, 6).map(vehicleHit);
}

function requestHit(row: Record<string, unknown>): AssistantCandidate {
  return candidate(
    String(row.id),
    labelOf(asText(row.request_code), asText(row.request_type), String(row.id)),
    asText(row.request_code) || undefined,
  );
}

async function findRequests(query: string, complaintOnly: boolean): Promise<AssistantCandidate[]> {
  const raw = query.trim();
  const keep = (row: Record<string, unknown>) => !complaintOnly || row.request_type === "complaint";
  if (UUID_RE.test(raw)) {
    const row = await docById(COLLECTIONS.requests, raw);
    if (row && keep(row)) return [requestHit(row)];
    return [];
  }
  const byCode = (await rowsWhere(COLLECTIONS.requests, "request_code", raw, 6)).filter(keep);
  if (byCode.length > 0) return byCode.map(requestHit);
  const fuzzy = (await scanCollection(COLLECTIONS.requests))
    .filter((row) => keep(row) && ilike(row.request_code, `%${raw}%`))
    .slice(0, 6);
  return fuzzy.map(requestHit);
}

async function findDeliveries(query: string): Promise<AssistantCandidate[]> {
  const raw = query.trim();
  const deliveryHit = (row: Record<string, unknown>) =>
    candidate(
      String(row.id),
      labelOf(asText(row.external_order_id), asText(row.status), String(row.id)),
      asText(row.external_order_id) || undefined,
    );
  if (UUID_RE.test(raw)) {
    const row = await docById(COLLECTIONS.deliveries, raw);
    if (row) return [deliveryHit(row)];
    return [];
  }
  const byOrder = await rowsWhere(COLLECTIONS.deliveries, "external_order_id", raw, 6);
  return byOrder.map(deliveryHit);
}

async function findGroups(query: string): Promise<AssistantCandidate[]> {
  const raw = query.trim();
  if (UUID_RE.test(raw)) {
    const row = await docById(COLLECTIONS.driverGroups, raw);
    if (row) return [namedHit(row)];
  }
  const scanned = await scanCollection(COLLECTIONS.driverGroups);
  const exact = scanned.filter((row) => ilike(row.name, raw)).slice(0, 6);
  if (exact.length > 0) return exact.map((row) => namedHit(row));
  return scanned.filter((row) => ilike(row.name, `%${raw}%`)).slice(0, 6).map((row) => namedHit(row));
}

function assetHit(row: Record<string, unknown>): AssistantCandidate {
  return candidate(
    String(row.id),
    labelOf(asText(row.code), asText(row.name), String(row.id)),
    asText(row.code) || undefined,
  );
}

async function findAssets(query: string): Promise<AssistantCandidate[]> {
  const raw = query.trim();
  if (UUID_RE.test(raw)) {
    const row = await docById(COLLECTIONS.assetCatalog, raw);
    if (row) return [assetHit(row)];
  }
  const byCode = await rowsWhere(COLLECTIONS.assetCatalog, "code", raw, 6);
  if (byCode.length > 0) return byCode.map(assetHit);
  const scanned = await scanCollection(COLLECTIONS.assetCatalog);
  const exact = scanned.filter((row) => ilike(row.name, raw)).slice(0, 6);
  if (exact.length > 0) return exact.map(assetHit);
  return scanned.filter((row) => ilike(row.name, `%${raw}%`)).slice(0, 6).map(assetHit);
}

async function findNotifications(query: string): Promise<AssistantCandidate[]> {
  const raw = query.trim();
  const hit = (row: Record<string, unknown>) => candidate(String(row.id), asText(row.title) || String(row.id));
  if (UUID_RE.test(raw)) {
    const row = await docById(COLLECTIONS.notificationCampaigns, raw);
    if (row) return [hit(row)];
  }
  const scanned = await scanCollection(COLLECTIONS.notificationCampaigns);
  const exact = scanned.filter((row) => ilike(row.title, raw)).slice(0, 6);
  if (exact.length > 0) return exact.map(hit);
  return scanned.filter((row) => ilike(row.title, `%${raw}%`)).slice(0, 6).map(hit);
}

async function hitsForType(type: AssistantEntityType, query: string): Promise<AssistantCandidate[]> {
  const raw = query.trim();
  switch (type) {
    case "driver":
      return findDrivers(raw);
    case "zone":
      return findZones(raw);
    case "restaurant":
      return findRestaurants(raw);
    case "partner":
      return findNamed("partners", raw);
    case "vehicle":
      return findVehicles(raw);
    case "request":
      return findRequests(raw, false);
    case "complaint":
      return findRequests(raw, true);
    case "delivery":
      return findDeliveries(raw);
    case "driver_group":
      return findGroups(raw);
    case "asset":
      return findAssets(raw);
    case "notification":
      return findNotifications(raw);
    case "fleet": {
      const q = raw.toLowerCase();
      if (!q || q === "fleet" || q === "الأسطول" || q === "اسطول") {
        return [candidate(FLEET_ENTITY_ID, "Fleet")];
      }
      const groups = await findGroups(raw);
      if (groups.length > 0) return groups;
      return findVehicles(raw);
    }
    case "attendance":
    case "payroll":
    case "performance": {
      if (/^\d{4}-\d{2}$/.test(raw)) return [candidate(raw, raw)];
      return findDrivers(raw);
    }
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

export async function resolveEntity(
  entityType: AssistantEntityType,
  query: string,
): Promise<AssistantResolveResult> {
  const raw = query.trim();
  const query_kind = classifyQueryKind(raw);
  if (!raw && entityType !== "fleet") {
    return { status: "not_found", entity_type: entityType, query_kind };
  }
  try {
    await requireAssistantModule(ENTITY_MODULE_PERMISSION[entityType]);
    const hits = await hitsForType(entityType, raw);
    const result = finalizeResolve(hits, entityType, query_kind);
    void logAdminRead("assistant", "assistant.tool", {
      tool: "resolve_entity",
      entity_type: entityType,
      query_kind,
      status: result.status,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "tool_failed";
    return { status: "error", error: message, entity_type: entityType };
  }
}
