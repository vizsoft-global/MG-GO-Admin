import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseFirestore } from "./admin";
import { COLLECTIONS } from "./db";

/** Mirrors `functions/src/core/rider-signals.ts`; the rider app listens to these counters. */
export type RiderSignalKey = "home" | "earnings" | "inbox" | "requests" | "esign" | "visits" | "profile";

const FIELD: Record<RiderSignalKey, string> = {
  home: "home_rev",
  earnings: "earnings_rev",
  inbox: "inbox_rev",
  requests: "requests_rev",
  esign: "esign_rev",
  visits: "visits_rev",
  profile: "profile_rev",
};

/** Never the caller's failure: the app's fallback refresh covers a missed bump. */
export async function bumpRiderSignals(
  uids: Iterable<string>,
  keys: readonly RiderSignalKey[],
  reason: string,
): Promise<void> {
  const unique = [...new Set([...uids].filter(Boolean))];
  if (unique.length === 0 || keys.length === 0) return;
  try {
    const db = await getFirebaseFirestore();
    if (!db) return;
    const patch: Record<string, unknown> = {
      updated_at_ms: Date.now(),
      last_reason: reason.slice(0, 64),
    };
    for (const key of new Set(keys)) patch[FIELD[key]] = FieldValue.increment(1);
    for (let i = 0; i < unique.length; i += 400) {
      const batch = db.batch();
      for (const uid of unique.slice(i, i + 400)) {
        batch.set(db.collection(COLLECTIONS.riderSignals).doc(uid), patch, { merge: true });
      }
      await batch.commit();
    }
  } catch {
    return;
  }
}
