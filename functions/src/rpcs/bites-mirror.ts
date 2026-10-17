/**
 * Store → driver assignments, mirrored into the Bites project.
 *
 * Bites-Admin runs on `bites-4f514` and cannot read `musallam-delivery-prod`, so
 * the delivery side pushes what the panel needs: which rider owns each store, and
 * the restaurant catalogue behind the duplicate check. The consumer app reads the
 * driver off its own order, which the milestone sync in `bites-order-sync.ts`
 * writes.
 *
 * The push is a direct call from the admin RPCs that write these rows (see the
 * `push*` exports below) rather than a Firestore trigger, because the live database
 * sits in a region this project cannot deploy compute to.
 *
 * Requires the runtime service account of `musallam-delivery-prod` to hold
 * `roles/datastore.user` on `bites-4f514`; without it every mirror write logs
 * `write_failed` and the panel sees no drivers.
 */
import "../core/init";
import { logger } from "firebase-functions";
import { Timestamp, type DocumentSnapshot, type Firestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import {
  BITES_MIRROR_COLLECTIONS,
  BITES_MIRROR_FIELDS,
  getBitesFirestore,
} from "../core/bites";

/** The `driver_restaurants` rider column, shared by the trigger and the lookup. */
const FIELDS_DRIVER_ID = "driver_id";

/** A rider identity as the panel shows it: a name and a number to ring. */
export type DriverIdentity = {  uid: string | null;
  name: string | null;
  phone: string | null;
};

export type PartnerLinkInput = {
  storeId: string | null;
  restaurantId: string;
  restaurantName: string | null;
  driver: DriverIdentity;
  at: Date;
  /** The rider the mirror currently links, so `assigned_at` only moves on a change. */
  previousDriverUid?: string | null;
};

export type RestaurantMirrorInput = {
  restaurantId: string;
  name: string | null;
  externalMerchantId: string | null;
  at: Date;
};

/**
 * Store-name key for duplicate detection.
 *
 * Bites-Admin refuses to create a store whose name already belongs to a restaurant
 * in the delivery project. Firestore cannot compare case-insensitively, so both
 * sides derive this key and compare it for equality. The panel's `normalizeStoreName`
 * in `store_duplicate_check.dart` must stay byte-identical to this.
 */
export function storeNameKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDict(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function dataOf(snap: DocumentSnapshot | null | undefined): Record<string, unknown> {
  if (!snap?.exists) return {};
  return asDict(snap.data());
}

/** The Bites store id a delivery-side restaurant is linked to. */
export function bitesStoreIdOf(restaurant: Record<string, unknown> | undefined): string | null {
  return textOf(restaurant?.[BITES_MIRROR_FIELDS.externalMerchantId]);
}

/**
 * Rider name and phone.
 *
 * `profiles` holds the staff-facing record and `drivers` the roster row; either can
 * carry the number, so both are read and the first non-empty wins. The order is
 * `bitesPartnerStamp`'s in `bites-order-sync.ts` on purpose: that stamp is what the
 * customer app dials from, and two fallback orders would let an operator and a
 * customer ring different numbers for the same rider.
 */
export function driverIdentityFrom(
  uid: string | null,
  driver: Record<string, unknown> | undefined,
  profile: Record<string, unknown> | undefined,
): DriverIdentity {
  return {
    uid,
    name:
      textOf(profile?.full_name) ?? textOf(driver?.full_name) ?? textOf(driver?.name),
    phone: textOf(profile?.phone) ?? textOf(driver?.phone) ?? textOf(driver?.driver_phone),
  };
}

/**
 * The `delivery_partner_links` document for a restaurant.
 *
 * A cleared assignment keeps the row but drops the rider fields, so the panel can
 * tell "this store exists but has no driver" from "this store is not mirrored".
 */
export function partnerLinkData(input: PartnerLinkInput): Record<string, unknown> {
  const stamp = Timestamp.fromDate(input.at);
  const driverChanged = input.driver.uid !== (input.previousDriverUid ?? null);
  return {
    [BITES_MIRROR_FIELDS.storeId]: input.storeId,
    [BITES_MIRROR_FIELDS.restaurantId]: input.restaurantId,
    [BITES_MIRROR_FIELDS.restaurantName]: input.restaurantName,
    [BITES_MIRROR_FIELDS.driverUid]: input.driver.uid,
    [BITES_MIRROR_FIELDS.driverName]: input.driver.name,
    [BITES_MIRROR_FIELDS.driverPhone]: input.driver.phone,
    [BITES_MIRROR_FIELDS.updatedAt]: stamp,
    ...(driverChanged
      ? { [BITES_MIRROR_FIELDS.assignedAt]: input.driver.uid ? stamp : null }
      : {}),
  };
}

/** The `delivery_restaurants` document, used to refuse duplicate stores. */
export function restaurantMirrorData(input: RestaurantMirrorInput): Record<string, unknown> {
  return {
    [BITES_MIRROR_FIELDS.restaurantId]: input.restaurantId,
    [BITES_MIRROR_FIELDS.name]: input.name,
    [BITES_MIRROR_FIELDS.nameKey]: storeNameKey(input.name),
    [BITES_MIRROR_FIELDS.externalMerchantId]: input.externalMerchantId,
    [BITES_MIRROR_FIELDS.updatedAt]: Timestamp.fromDate(input.at),
  };
}

/** Builds the mirror writes for one assignment change. Empty when the store is unlinked. */
export async function syncDriverAssignmentLink(
  db: Firestore,
  restaurantId: string,
  driverIdHint: string | null,
  at: Date,
  bites: Firestore = getBitesFirestore(),
): Promise<void> {
  const restaurantSnap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get();
  const restaurant = dataOf(restaurantSnap);
  const storeId = bitesStoreIdOf(restaurant);
  const linkRef = bites
    .collection(BITES_MIRROR_COLLECTIONS.partnerLinks)
    .doc(restaurantId);

  // A restaurant the delivery side does not link to a Bites store has nothing to
  // mirror, and any earlier link is now stale.
  if (!storeId) {
    await linkRef.delete();
    return;
  }

  const driverId = driverIdHint ?? (await firstAssignedDriverId(db, restaurantId));
  const existing = await linkRef.get();
  const [driver, profile] = await Promise.all([
    readDoc(db, COLLECTIONS.drivers, driverId),
    readDoc(db, COLLECTIONS.profiles, driverId),
  ]);

  await linkRef.set(
    partnerLinkData({
      storeId,
      restaurantId,
      restaurantName: textOf(restaurant[BITES_MIRROR_FIELDS.name]),
      driver: driverIdentityFrom(driverId, driver, profile),
      at,
      previousDriverUid: textOf(dataOf(existing)[BITES_MIRROR_FIELDS.driverUid]),
    }),
    { merge: true },
  );
}

/** Mirrors one restaurant row, and keeps its link in step when the row changes. */
export async function syncRestaurantMirror(
  db: Firestore,
  restaurantId: string,
  restaurant: Record<string, unknown> | null,
  at: Date,
  bites: Firestore = getBitesFirestore(),
): Promise<void> {
  const mirrorRef = bites
    .collection(BITES_MIRROR_COLLECTIONS.restaurants)
    .doc(restaurantId);

  if (!restaurant) {
    await Promise.all([
      mirrorRef.delete(),
      bites.collection(BITES_MIRROR_COLLECTIONS.partnerLinks).doc(restaurantId).delete(),
    ]);
    return;
  }

  await Promise.all([
    mirrorRef.set(
      restaurantMirrorData({
        restaurantId,
        name: textOf(restaurant[BITES_MIRROR_FIELDS.name]),
        externalMerchantId: bitesStoreIdOf(restaurant),
        at,
      }),
      { merge: true },
    ),
    // The link carries the restaurant name and the store id, so both are refreshed
    // here rather than waiting for the next assignment write.
    syncDriverAssignmentLink(db, restaurantId, null, at, bites),
  ]);
}

/** Refreshes the name and phone on every link a rider is attached to. */
export async function syncDriverIdentity(
  db: Firestore,
  driverId: string,
  at: Date,
  bites: Firestore = getBitesFirestore(),
): Promise<number> {
  const links = await bites
    .collection(BITES_MIRROR_COLLECTIONS.partnerLinks)
    .where(BITES_MIRROR_FIELDS.driverUid, "==", driverId)
    .limit(20)
    .get();
  if (links.empty) return 0;

  const [driver, profile] = await Promise.all([
    readDoc(db, COLLECTIONS.drivers, driverId),
    readDoc(db, COLLECTIONS.profiles, driverId),
  ]);
  const identity = driverIdentityFrom(driverId, driver, profile);
  const stamp = Timestamp.fromDate(at);

  const batch = bites.batch();
  for (const doc of links.docs) {
    batch.set(
      doc.ref,
      {
        [BITES_MIRROR_FIELDS.driverName]: identity.name,
        [BITES_MIRROR_FIELDS.driverPhone]: identity.phone,
        [BITES_MIRROR_FIELDS.updatedAt]: stamp,
      },
      { merge: true },
    );
  }
  await batch.commit();
  return links.size;
}

async function readDoc(
  db: Firestore,
  collection: string,
  id: string | null,
): Promise<Record<string, unknown> | undefined> {
  if (!id) return undefined;
  return dataOf(await db.collection(collection).doc(id).get());
}

async function firstAssignedDriverId(db: Firestore, restaurantId: string): Promise<string | null> {
  const snap = await db
    .collection(COLLECTIONS.driverRestaurants)
    .where(BITES_MIRROR_FIELDS.restaurantId, "==", restaurantId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return textOf(snap.docs[0].data()[FIELDS_DRIVER_ID]);
}

/**
 * Push entry points.
 *
 * These used to be Firestore triggers. They cannot be: the live database is the
 * named `default` in me-central2, Firebase forces a Firestore trigger into the
 * database's region, and this project's agreement blocks compute in me-central2
 * (`LOCATION_POLICY_VIOLATED` — Artifact Registry and Cloud Functions both refuse
 * to create anything there). So the admin RPCs that own these writes call the
 * `sync*` functions directly instead.
 *
 * Every push is best effort. A Bites outage must not fail a delivery-side admin
 * action, so the failure is logged and swallowed; only the `sync*` functions
 * throw, which keeps them testable.
 */
export async function pushRestaurantMirror(
  db: Firestore,
  restaurantId: string,
  at: Date = new Date(),
  bites: Firestore = getBitesFirestore(),
): Promise<boolean> {
  try {
    const snap = await db.collection(COLLECTIONS.restaurants).doc(restaurantId).get();
    await syncRestaurantMirror(db, restaurantId, snap.exists ? dataOf(snap) : null, at, bites);
    return true;
  } catch (err) {
    logger.error("bites mirror: restaurant push failed", { restaurantId, err });
    return false;
  }
}

/** A deleted assignment row loses its rider, so the caller passes `null`. */
export async function pushAssignmentMirror(
  db: Firestore,
  restaurantId: string,
  driverId: string | null,
  at: Date = new Date(),
  bites: Firestore = getBitesFirestore(),
): Promise<boolean> {
  try {
    await syncDriverAssignmentLink(db, restaurantId, driverId, at, bites);
    return true;
  } catch (err) {
    logger.error("bites mirror: assignment push failed", { restaurantId, driverId, err });
    return false;
  }
}

export async function pushDriverIdentityMirror(
  db: Firestore,
  driverId: string,
  at: Date = new Date(),
  bites: Firestore = getBitesFirestore(),
): Promise<boolean> {
  try {
    await syncDriverIdentity(db, driverId, at, bites);
    return true;
  } catch (err) {
    logger.error("bites mirror: driver identity push failed", { driverId, err });
    return false;
  }
}
