import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * The Bites customer project. Orders, bills and the customer-facing timeline
 * live here; the delivery project only stamps the fulfilment milestones onto
 * them, so both apps agree on where an order has got to.
 */
export const BITES_PROJECT_ID = "bites-4f514";

/**
 * `bites-4f514`'s default database is `(default)` — with the parentheses.
 *
 * The id is not interchangeable with the delivery project's. `musallam-delivery-prod`
 * has a database literally named `default` (see `core/fs.ts`), while Bites' default is
 * the legacy `(default)` resource. The Admin SDK passes the id straight into
 * `projects/{project}/databases/{id}`, so the wrong spelling is a 404 on a database
 * that does not exist — not a fallback. Every `bites-4f514` write fails invisibly,
 * because the mirror wrappers swallow the error by design.
 */
export const BITES_DATABASE_ID = "(default)";

/** Named app, so the delivery project's default app is left untouched. */
const BITES_APP_NAME = "bites-4f514";

/** `orders` is the only Bites collection the delivery side writes. */
export const BITES_COLLECTIONS = {
  orders: "orders",
} as const;

/**
 * Collections the delivery side mirrors into Bites.
 *
 * Bites-Admin runs on the Bites project with no access to `musallam-delivery-prod`,
 * so the store→driver assignment and the restaurant catalogue travel to it as a
 * mirror rather than as a cross-project read.
 */
export const BITES_MIRROR_COLLECTIONS = {
  /** One doc per restaurant, keyed by restaurant id. `store_id` is the Bites store. */
  partnerLinks: "delivery_partner_links",
  /** Mirror of `restaurants`, so store creation can refuse to duplicate one. */
  restaurants: "delivery_restaurants",
} as const;

/** Field names for the mirrors. Must match what Bites-Admin reads. */
export const BITES_MIRROR_FIELDS = {
  restaurantId: "restaurant_id",
  restaurantName: "restaurant_name",
  storeId: "store_id",
  driverUid: "driver_uid",
  driverName: "driver_name",
  driverPhone: "driver_phone",
  assignedAt: "assigned_at",
  updatedAt: "updated_at",
  name: "name",
  /** `name` with case, spaces and punctuation stripped, for duplicate checks. */
  nameKey: "name_key",
  externalMerchantId: "external_merchant_id",
} as const;

/** `orders` field names on the Bites side. */
export const BITES_ORDER_FIELDS = {
  id: "order_id",
  status: "order_status",
  deliveryInfo: "delivery_info",
  updatedAt: "updated_at",
} as const;

/**
 * `orders.delivery_info` field names on the Bites side. Must match
 * `DeliveryInfoStruct` in the customer app — a typo here writes a field nothing
 * reads, and the customer app silently keeps showing the previous milestone.
 */
export const BITES_DELIVERY_FIELDS = {
  status: "status",
  assignedTime: "assigned_time",
  packedTime: "packed_time",
  pickupTime: "pickup_time",
  deliveredTime: "delivered_time",
  partnerUid: "delivery_partner_uid",
  partnerName: "delivery_partner_name",
  partnerPhone: "delivery_partner_phone",
} as const;

/** `order_status` values the Bites apps branch on. */
export const BITES_ORDER_STATUS = {
  assigned: "DPASSIGNED",
  packed: "PACKED",
  picked: "PICKED",
  delivered: "DELIVERED",
} as const;

let bitesFactoryForTests: (() => Firestore) | null = null;

/** Test seam. Production leaves this null and uses the Admin SDK. */
export function setBitesFirestoreForTests(factory: (() => Firestore) | null): void {
  bitesFactoryForTests = factory;
}

/**
 * Firestore for `bites-4f514`.
 *
 * The cross-project write borrows the runtime service account of
 * `musallam-delivery-prod`, so that account needs `roles/datastore.user` on the
 * Bites project. Without the grant every milestone write fails with
 * PERMISSION_DENIED and the customer app sits on "Preparing" forever.
 */
export function getBitesFirestore(): Firestore {
  if (bitesFactoryForTests) return bitesFactoryForTests();
  const existing = getApps().find((app) => app.name === BITES_APP_NAME);
  const app =
    existing ??
    initializeApp(
      { credential: applicationDefault(), projectId: BITES_PROJECT_ID },
      BITES_APP_NAME,
    );
  return getFirestore(app, BITES_DATABASE_ID);
}
