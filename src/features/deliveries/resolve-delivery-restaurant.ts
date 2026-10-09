import type { DeliveryListRow } from "./types";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import type { DocumentData, Firestore } from "firebase-admin/firestore";

export type ResolvedRestaurant = {
  id: string;
  name: string;
};

type DeliveryRestaurantInput = {
  id: string;
  driver_id: string;
  partner_id: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
};

type RestaurantRow = {
  id: string;
  name: string;
  partner_id: string | null;
  status: string | null;
  is_active: boolean | null;
};

type Row = Record<string, unknown> & { id: string };

function plainValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if ("toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(plainValue);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = plainValue(child);
  }
  return out;
}

function asRow(id: string, data: DocumentData | undefined): Row {
  return { id, ...((plainValue(data ?? {}) as Record<string, unknown>) ?? {}) };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function restaurantOf(row: Row): RestaurantRow {
  return {
    id: row.id,
    name: str(row.name),
    partner_id: str(row.partner_id) || null,
    status: str(row.status) || null,
    is_active: row.is_active == null ? null : row.is_active === true,
  };
}

async function openDb(): Promise<Firestore | null> {
  return staffDb();
}

async function rowsByIds(db: Firestore, collection: string, ids: string[]): Promise<Row[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows: Row[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const refs = unique.slice(i, i + 100).map((id) => db.collection(collection).doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) rows.push(asRow(snap.id, snap.data()));
    }
  }
  return rows;
}

async function whereIn(db: Firestore, collection: string, field: string, ids: string[]): Promise<Row[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows: Row[] = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    if (chunk.length === 0) continue;
    const snap = await db.collection(collection).where(field, "in", chunk).get();
    rows.push(...snap.docs.map((doc) => asRow(doc.id, doc.data())));
  }
  return rows;
}

function pickUniqueRestaurant(candidates: RestaurantRow[]): ResolvedRestaurant | null {
  if (candidates.length !== 1) return null;
  const row = candidates[0]!;
  return { id: row.id, name: row.name };
}

function publishedRestaurants(candidates: RestaurantRow[]): RestaurantRow[] {
  return candidates.filter(
    (r) => r.is_active !== false && (r.status == null || r.status === "published"),
  );
}

function pickDisplayRestaurant(
  candidates: RestaurantRow[],
  partnerId: string | null,
): ResolvedRestaurant | null {
  const published = publishedRestaurants(candidates);
  if (published.length === 0) return null;

  const pool = partnerId
    ? published.filter((r) => r.partner_id === partnerId)
    : published;
  if (pool.length === 0) return null;

  const row = [...pool].sort((a, b) => a.name.localeCompare(b.name))[0]!;
  return { id: row.id, name: row.name };
}

function resolveFromAssigned(
  assigned: RestaurantRow[],
  partnerId: string | null,
): ResolvedRestaurant | null {
  const unique = pickUniqueRestaurant(publishedRestaurants(assigned));
  if (unique) return unique;
  return pickDisplayRestaurant(assigned, partnerId);
}

function resolveFromPartnerRestaurants(
  partnerRestaurants: RestaurantRow[],
): ResolvedRestaurant | null {
  const unique = pickUniqueRestaurant(publishedRestaurants(partnerRestaurants));
  if (unique) return unique;
  return pickDisplayRestaurant(partnerRestaurants, null);
}

export async function batchResolveDeliveryRestaurants(
  deliveries: DeliveryRestaurantInput[],
): Promise<Map<string, ResolvedRestaurant>> {
  const unresolved = deliveries.filter((d) => !d.restaurant_name?.trim());
  const result = new Map<string, ResolvedRestaurant>();
  if (unresolved.length === 0) return result;

  const db = await openDb();
  if (!db) return result;

  const withRestaurantId = unresolved.filter(
    (d): d is DeliveryRestaurantInput & { restaurant_id: string } => Boolean(d.restaurant_id),
  );
  if (withRestaurantId.length > 0) {
    const restaurantIds = [...new Set(withRestaurantId.map((d) => d.restaurant_id))];
    const restaurantRows = await rowsByIds(db, COLLECTIONS.restaurants, restaurantIds);
    const nameById = new Map(restaurantRows.map((row) => [row.id, str(row.name)] as const));
    for (const delivery of withRestaurantId) {
      const name = nameById.get(delivery.restaurant_id);
      if (name) result.set(delivery.id, { id: delivery.restaurant_id, name });
    }
  }

  const needsInference = unresolved.filter((d) => !result.has(d.id) && !d.restaurant_id);
  if (needsInference.length === 0) return result;

  const driverIds = [...new Set(needsInference.map((d) => d.driver_id))];
  const partnerIds = [
    ...new Set(needsInference.map((d) => d.partner_id).filter((id): id is string => Boolean(id))),
  ];

  const [driverRestRows, partnerRestRows] = await Promise.all([
    whereIn(db, COLLECTIONS.driverRestaurants, "driver_id", driverIds),
    partnerIds.length > 0
      ? whereIn(db, COLLECTIONS.restaurants, "partner_id", partnerIds)
      : Promise.resolve([] as Row[]),
  ]);

  const restaurantIds = driverRestRows.map((row) => str(row.restaurant_id)).filter(Boolean);
  const linked = await rowsByIds(db, COLLECTIONS.restaurants, restaurantIds);
  const restaurantById = new Map(linked.map((row) => [row.id, restaurantOf(row)]));

  const assignedByDriver = new Map<string, RestaurantRow[]>();
  for (const link of driverRestRows) {
    const row = restaurantById.get(str(link.restaurant_id));
    if (!row?.id) continue;
    const list = assignedByDriver.get(str(link.driver_id)) ?? [];
    list.push(row);
    assignedByDriver.set(str(link.driver_id), list);
  }

  const partnerRestaurantsByPartner = new Map<string, RestaurantRow[]>();
  const partnerRows = [...partnerRestRows]
    .map(restaurantOf)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const row of partnerRows) {
    if (!row.partner_id) continue;
    const list = partnerRestaurantsByPartner.get(row.partner_id) ?? [];
    list.push(row);
    partnerRestaurantsByPartner.set(row.partner_id, list);
  }

  for (const delivery of needsInference) {
    const fromAssigned = resolveFromAssigned(
      assignedByDriver.get(delivery.driver_id) ?? [],
      delivery.partner_id,
    );
    if (fromAssigned) {
      result.set(delivery.id, fromAssigned);
      continue;
    }
    if (delivery.partner_id) {
      const fromPartner = resolveFromPartnerRestaurants(
        partnerRestaurantsByPartner.get(delivery.partner_id) ?? [],
      );
      if (fromPartner) result.set(delivery.id, fromPartner);
    }
  }

  return result;
}

export async function enrichDeliveryListRows(rows: DeliveryListRow[]): Promise<DeliveryListRow[]> {
  const resolved = await batchResolveDeliveryRestaurants(rows);
  if (resolved.size === 0) return rows;
  return rows.map((row) => {
    const inferred = resolved.get(row.id);
    if (!inferred) return row;
    return {
      ...row,
      restaurant_id: row.restaurant_id ?? inferred.id,
      restaurant_name: row.restaurant_name ?? inferred.name,
    };
  });
}
