import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, type Query } from "../core/fs";
import { COLLECTIONS, FIELDS } from "../core/collections";
import { parseIdList } from "../core/query";
import { requireStaff } from "../core/staff";

/** Firestore caps one commit at 500 writes, and an `in` filter at 30 values. */
export const DELETE_CHUNK = 400;
const IN_CHUNK = 30;

export async function deleteByIds(collection: string, ids: readonly string[]): Promise<number> {
  const db = getFirestore();
  let deleted = 0;
  for (let index = 0; index < ids.length; index += DELETE_CHUNK) {
    const slice = ids.slice(index, index + DELETE_CHUNK);
    const batch = db.batch();
    for (const id of slice) batch.delete(db.collection(collection).doc(id));
    await batch.commit();
    deleted += slice.length;
  }
  return deleted;
}

/** An `in` delete, chunked because Firestore caps an `in` filter at 30 values. */
export async function deleteWhereIn(
  collection: string,
  field: string,
  values: readonly string[],
): Promise<void> {
  if (values.length === 0) return;
  const db = getFirestore();
  for (let index = 0; index < values.length; index += IN_CHUNK) {
    const slice = values.slice(index, index + IN_CHUNK);
    const snap = await db
      .collection(collection)
      .where(field, "in", slice)
      .limit(DELETE_CHUNK)
      .get();
    if (snap.empty) continue;
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }
}

export function collectStorageKeys(
  entity: string,
  collection: string,
  data: Record<string, unknown>,
  into: string[],
): void {
  const push = (value: unknown) => {
    if (typeof value === "string" && value.length > 0) into.push(value);
  };
  const pushList = (value: unknown) => {
    if (Array.isArray(value)) for (const entry of value) push(entry);
  };

  if (entity === "deliveries" && collection === COLLECTIONS.deliveries) {
    push(data.delivery_proof_key);
    push(data.pickup_proof_key);
    push(data.cancel_proof_key);
    pushList(data.proof_keys);
  } else if (entity === "drivers") {
    push(data.avatar_object_key);
    push(data.avatar_url);
    pushList(data.document_keys);
  } else if (entity === "assets" && collection === COLLECTIONS.assetCatalog) {
    push(data.image_key);
    pushList(data.image_keys);
  } else if (entity === "fuel") {
    push(data.receipt_key);
    pushList(data.receipt_keys);
  } else if (entity === "esign") {
    push(data.document_storage_key);
    push(data.signed_document_storage_key);
  } else if (entity === "documents") {
    push(data.storage_key);
  }
}

/**
 * The FK release the SQL did before deleting.
 *
 * `ON DELETE SET NULL` has no Firestore equivalent, so a driver id left on a
 * vehicle would outlive the driver and the fleet list would render a link to
 * nobody. Nulling is deliberately best-effort per document: one unreadable
 * vehicle must not make the whole module unclearable.
 */
export async function releaseForeignKeyGuards(entity: string): Promise<void> {
  const db = getFirestore();
  const nullOut = async (collection: string, fields: readonly string[], where: Query) => {
    const snap = await where.limit(DELETE_CHUNK).get();
    if (snap.empty) return;
    const batch = db.batch();
    for (const doc of snap.docs) {
      const update: Record<string, null> = {};
      for (const field of fields) update[field] = null;
      batch.update(doc.ref, update);
    }
    await batch.commit();
  };

  if (entity === "drivers") {
    await Promise.all([
      nullOut(COLLECTIONS.vehicles, ["current_driver_id"], db.collection(COLLECTIONS.vehicles)),
      nullOut(
        COLLECTIONS.driverGroups,
        ["leader_driver_id"],
        db.collection(COLLECTIONS.driverGroups),
      ),
    ]);
  } else if (entity === "restaurants") {
    await nullOut(
      COLLECTIONS.drivers,
      [FIELDS.drivers.restaurantId],
      db.collection(COLLECTIONS.drivers).where(FIELDS.drivers.restaurantId, "!=", null),
    );
  } else if (entity === "zones") {
    await Promise.all([
      nullOut(
        COLLECTIONS.drivers,
        [FIELDS.drivers.zoneId],
        db.collection(COLLECTIONS.drivers).where(FIELDS.drivers.zoneId, "!=", null),
      ),
      nullOut(
        COLLECTIONS.restaurants,
        ["zone_id"],
        db.collection(COLLECTIONS.restaurants).where("zone_id", "!=", null),
      ),
    ]);
  } else if (entity === "partners") {
    await nullOut(
      COLLECTIONS.drivers,
      [FIELDS.drivers.partnerId],
      db.collection(COLLECTIONS.drivers).where(FIELDS.drivers.partnerId, "!=", null),
    );
  } else if (entity === "vehicles") {
    await nullOut(
      COLLECTIONS.drivers,
      [FIELDS.drivers.vehicleId],
      db.collection(COLLECTIONS.drivers).where(FIELDS.drivers.vehicleId, "!=", null),
    );
  } else if (entity === "assets") {
    await nullOut(
      COLLECTIONS.drivers,
      ["asset_ids"],
      db.collection(COLLECTIONS.drivers).where("asset_ids", "!=", null),
    );
  }
}

function requireIds(data: Record<string, unknown>): string[] {
  const ids = parseIdList(data.p_ids ?? data.ids) ?? [];
  if (ids.length === 0) throw new HttpsError("invalid-argument", "invalid_ids");
  return [...new Set(ids)];
}

/**
 * `admin_purge_deliveries` — the delivery rows and the proof keys on them.
 *
 * The keys come back for the caller to sweep, because R2 has no transaction to
 * join and deleting the object first would leave a row pointing at nothing.
 */
export const adminPurgeDeliveries = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  await requireStaff(request, "deliveries.bulk_delete");
  const ids = requireIds(data);

  const db = getFirestore();
  const storageKeys: string[] = [];
  for (const id of ids) {
    const snap = await db.collection(COLLECTIONS.deliveries).doc(id).get();
    if (snap.exists) {
      collectStorageKeys("deliveries", COLLECTIONS.deliveries, snap.data() ?? {}, storageKeys);
    }
  }
  await deleteByIds(COLLECTIONS.deliveries, ids);
  return { deleted: ids.length, storage_keys: storageKeys };
});

/**
 * `admin_purge_drivers` — profile, driver row, dependents and the Auth manifest.
 *
 * The Auth user ids are returned rather than deleted here: `deleteUser` is an
 * Auth API call that cannot join a batch, so the caller performs it and a
 * failure there leaves a driver row whose account can be cleaned up separately,
 * instead of a half-deleted account.
 */
export const adminPurgeDrivers = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  await requireStaff(request, "drivers.bulk_delete");
  const ids = requireIds(data);

  const db = getFirestore();
  const storageKeys: string[] = [];
  const manifest: Array<{ auth_user_id: string; driver_id: string }> = [];

  for (const id of ids) {
    const snap = await db.collection(COLLECTIONS.drivers).doc(id).get();
    if (snap.exists) {
      collectStorageKeys("drivers", COLLECTIONS.drivers, snap.data() ?? {}, storageKeys);
    }
    manifest.push({ auth_user_id: id, driver_id: id });
  }

  await releaseForeignKeyGuards("drivers");

  const dependents = [
    [COLLECTIONS.driverRestaurants, "driver_id"],
    [COLLECTIONS.driverOffStructure, "driver_id"],
    [COLLECTIONS.driverDailyShifts, "driver_id"],
    [COLLECTIONS.attendanceLogs, FIELDS.attendanceLogs.driverId],
    [COLLECTIONS.driverSessions, "driver_id"],
    [COLLECTIONS.driverLocations, "driver_id"],
    [COLLECTIONS.documentTracking, "driver_id"],
  ] as const;

  for (const [collection, field] of dependents) {
    await deleteWhereIn(collection, field, ids);
  }

  await deleteByIds(COLLECTIONS.drivers, ids);
  await deleteByIds(COLLECTIONS.driverIntakes, ids);
  await deleteByIds(COLLECTIONS.profiles, ids);

  return { deleted: ids.length, storage_keys: storageKeys, manifest };
});

/** `admin_purge_intakes` — the intake rows and the storage prefixes they own. */
export const adminPurgeIntakes = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  await requireStaff(request, "drivers.bulk_delete");
  const ids = requireIds(data);

  const db = getFirestore();
  const snapshots = await Promise.all(
    ids.map((id) => db.collection(COLLECTIONS.driverIntakes).doc(id).get()),
  );
  const storagePrefixes: string[] = [];
  const storageKeys: string[] = [];
  for (const snap of snapshots) {
    if (!snap.exists) continue;
    storagePrefixes.push(`drivers/intakes/${snap.id}/`);
    collectStorageKeys("drivers", COLLECTIONS.driverIntakes, snap.data() ?? {}, storageKeys);
  }

  await deleteByIds(COLLECTIONS.driverIntakes, ids);
  return { deleted: ids.length, storage_prefixes: storagePrefixes, storage_keys: storageKeys };
});

/** `admin_purge_restaurants` — the geofences first, then the merchant. */
export const adminPurgeRestaurants = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  await requireStaff(request, "restaurants.bulk_delete");
  const ids = requireIds(data);

  await deleteWhereIn(COLLECTIONS.restaurantGeofences, "restaurant_id", ids);
  await releaseForeignKeyGuards("restaurants");

  const storagePrefixes = ids.map((id) => `restaurants/${id}/`);
  await deleteByIds(COLLECTIONS.restaurants, ids);

  return { deleted: ids.length, storage_prefixes: storagePrefixes };
});

/** `admin_purge_zones` — the zone rows, after the references that point at them. */
export const adminPurgeZones = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  await requireStaff(request, "zones.bulk_delete");
  const ids = requireIds(data);

  await releaseForeignKeyGuards("zones");
  await deleteByIds(COLLECTIONS.zones, ids);
  return { deleted: ids.length };
});

/** `admin_purge_delivery_rules` — the scopes go with the rule. */
export const adminPurgeDeliveryRules = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  await requireStaff(request, "earnings.bulk_delete");
  const ids = requireIds(data);

  await deleteWhereIn(COLLECTIONS.deliveryRuleScopes, "rule_id", ids);
  await deleteByIds(COLLECTIONS.deliveryRules, ids);
  return { deleted: ids.length };
});

/** `admin_purge_incentive_rules` — tiers and scopes go with the rule. */
export const adminPurgeIncentiveRules = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  await requireStaff(request, "earnings.bulk_delete");
  const ids = requireIds(data);

  await Promise.all([
    deleteWhereIn(COLLECTIONS.incentiveRuleScopes, "rule_id", ids),
    deleteWhereIn(COLLECTIONS.incentiveRuleTiers, "rule_id", ids),
  ]);
  await deleteByIds(COLLECTIONS.incentiveRules, ids);
  return { deleted: ids.length };
});

/** `admin_purge_asset_catalog` — the catalogue rows and their image keys. */
export const adminPurgeAssetCatalog = onCall(async (request) => {
  const data = (request.data ?? {}) as Record<string, unknown>;
  await requireStaff(request, "assets.bulk_delete");
  const ids = requireIds(data);

  const db = getFirestore();
  const storageKeys: string[] = [];
  const snapshots = await Promise.all(
    ids.map((id) => db.collection(COLLECTIONS.assetCatalog).doc(id).get()),
  );
  for (const snap of snapshots) {
    if (snap.exists) {
      collectStorageKeys("assets", COLLECTIONS.assetCatalog, snap.data() ?? {}, storageKeys);
    }
  }

  await deleteWhereIn(COLLECTIONS.assetAssignments, "asset_id", ids);
  await deleteByIds(COLLECTIONS.assetCatalog, ids);

  return { deleted: ids.length, storage_keys: storageKeys };
});
