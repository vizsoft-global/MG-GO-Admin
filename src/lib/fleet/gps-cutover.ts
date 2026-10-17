import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/db";

const R2_SINCE_TTL_MS = 5 * 60_000;
let r2SinceCache: { value: string | null; at: number } | null = null;

/** First Kuwait day whose GPS history lives in R2; earlier days stay on Firestore. */
export async function gpsR2Since(db: Firestore): Promise<string | null> {
  if (r2SinceCache && Date.now() - r2SinceCache.at < R2_SINCE_TTL_MS) return r2SinceCache.value;
  const snap = await db.collection(COLLECTIONS.appSettings).doc("1").get();
  const raw = snap.data()?.location_gps_r2_since;
  const value = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  r2SinceCache = { value, at: Date.now() };
  return value;
}
