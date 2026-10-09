import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore as getFirestoreAdmin } from "firebase-admin/firestore";

/**
 * Named database on musallam-delivery-prod (Enterprise, me-central2).
 *
 * The Admin SDK's no-arg `getFirestore()` talks to `(default)`, which is a
 * different database (and after a failed CLI create, a nam5 Standard one).
 * Every callable goes through this helper so a missed import cannot silently
 * write to the wrong region.
 */
export const FIRESTORE_DATABASE_ID = "default";

export function getFirestore() {
  const app = getApps()[0] ?? initializeApp();
  return getFirestoreAdmin(app, FIRESTORE_DATABASE_ID);
}

export {
  FieldPath,
  FieldValue,
  Filter,
  GeoPoint,
  Timestamp,
} from "firebase-admin/firestore";

export type {
  CollectionReference,
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  QueryDocumentSnapshot,
  QuerySnapshot,
  SetOptions,
  Transaction,
  UpdateData,
  WriteBatch,
} from "firebase-admin/firestore";
