import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseFirestore } from "./admin";

/**
 * The staff Firestore handle.
 *
 * Returns null when the Admin SDK is not configured, matching `getFirebaseAuth`:
 * a missing service account is a configuration failure the caller already turns
 * into `{ error: "not_configured" }`, not a throw that becomes a 500.
 */
export async function staffDb(): Promise<Firestore | null> {
  return getFirebaseFirestore();
}

/** `{ id, ...fields }` — the shape PostgREST returned for a row. */
export function rowOf<T extends Record<string, unknown>>(
  id: string,
  data: FirebaseFirestore.DocumentData | undefined,
): (T & { id: string }) | null {
  if (!data) return null;
  return { id, ...(data as T) };
}
