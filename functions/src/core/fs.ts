import "./init";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore as getFirestoreAdmin } from "firebase-admin/firestore";
import { installFsMetrics } from "./fs-metrics";

/**
 * Named database on musallam-delivery-prod (Enterprise, me-central2).
 *
 * The Admin SDK's no-arg `getFirestore()` talks to `(default)`, which is a
 * different database (and after a failed CLI create, a nam5 Standard one).
 * Every callable goes through this helper so a missed import cannot silently
 * write to the wrong region.
 */
export const FIRESTORE_DATABASE_ID = "default";

type FirestoreClient = ReturnType<typeof getFirestoreAdmin>;

/** Test seam. Production leaves this null and uses the Admin SDK. */
let firestoreFactoryForTests: (() => FirestoreClient) | null = null;

export function setFirestoreFactoryForTests(factory: (() => FirestoreClient) | null): void {
  firestoreFactoryForTests = factory;
}

export function getFirestore() {
  installFsMetrics();
  if (firestoreFactoryForTests) return firestoreFactoryForTests();
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
