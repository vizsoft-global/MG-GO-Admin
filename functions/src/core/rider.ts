import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "./fs";
import { COLLECTIONS, FIELDS } from "./collections";

export type RiderContext = {
  uid: string;
  driver: Record<string, unknown>;
  profile: Record<string, unknown>;
};

/**
 * Rider callables: the Firebase Auth uid IS `drivers.id`.
 * Staff accounts are refused even if they have a leftover driver-shaped token.
 */
export async function requireRider(request: CallableRequest<unknown>): Promise<RiderContext> {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "not_authenticated");
  }

  const db = getFirestore();
  const [driverSnap, profileSnap] = await Promise.all([
    db.collection(COLLECTIONS.drivers).doc(uid).get(),
    db.collection(COLLECTIONS.profiles).doc(uid).get(),
  ]);

  if (!driverSnap.exists) {
    throw new HttpsError("not-found", "driver_not_found");
  }

  const profile = profileSnap.data() ?? {};
  if (profile[FIELDS.profiles.role] === "staff") {
    throw new HttpsError("permission-denied", "staff_not_allowed");
  }

  return { uid, driver: driverSnap.data() ?? {}, profile };
}

/** HttpsError whose `message` is the old PostgREST/edge error string. */
export function riderError(
  code: "unauthenticated" | "permission-denied" | "failed-precondition" | "not-found" | "invalid-argument" | "already-exists" | "internal" | "resource-exhausted",
  error: string,
  details?: Record<string, unknown>,
): HttpsError {
  return new HttpsError(code, error, { error, ...details });
}
