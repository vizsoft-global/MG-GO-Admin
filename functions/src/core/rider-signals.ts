import { FieldValue, getFirestore, type Firestore, type WriteBatch } from "./fs";
import { COLLECTIONS } from "./collections";

/**
 * What changed for one rider. The app holds a single snapshot listener on
 * `rider_signals/{uid}` and refetches only the screen whose counter moved, so a
 * bump costs one write here and one listener read on that rider's phone.
 */
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

export function riderSignalPatch(
  keys: readonly RiderSignalKey[],
  reason: string,
  nowMs = Date.now(),
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    updated_at_ms: nowMs,
    last_reason: reason.slice(0, 64),
  };
  for (const key of new Set(keys)) patch[FIELD[key]] = FieldValue.increment(1);
  return patch;
}

/** Inbox writes also move the counter of the screen the item deep-links to. */
export function signalKeysForRecordType(recordType: unknown): RiderSignalKey[] {
  switch (typeof recordType === "string" ? recordType : "") {
    case "request":
      return ["inbox", "requests"];
    case "esign":
      return ["inbox", "esign"];
    case "visit":
    case "appointment":
      return ["inbox", "visits"];
    case "delivery":
    case "dpd_target":
    case "company_scheme":
    case "incentive_rule":
    case "delivery_rule":
    case "compliance":
    case "home":
      return ["inbox", "home", "earnings"];
    default:
      return ["inbox"];
  }
}

export function bumpRiderSignalInBatch(
  db: Firestore,
  batch: WriteBatch,
  uid: string,
  keys: readonly RiderSignalKey[],
  reason: string,
): void {
  if (!uid || keys.length === 0) return;
  batch.set(db.collection(COLLECTIONS.riderSignals).doc(uid), riderSignalPatch(keys, reason), {
    merge: true,
  });
}

/**
 * Never the writer's failure: the app's 30-minute fallback refresh covers a
 * missed bump, so a signal error only costs freshness.
 */
export async function bumpRiderSignal(
  uid: string | null | undefined,
  keys: readonly RiderSignalKey[],
  reason: string,
): Promise<void> {
  if (!uid || keys.length === 0) return;
  try {
    await getFirestore()
      .collection(COLLECTIONS.riderSignals)
      .doc(uid)
      .set(riderSignalPatch(keys, reason), { merge: true });
  } catch {
    // covered by the fallback refresh
  }
}

/** Fan-out for writers that touch several riders at once (bulk verify, dispatch). */
export async function bumpRiderSignals(
  uids: Iterable<string>,
  keys: readonly RiderSignalKey[],
  reason: string,
): Promise<void> {
  const unique = [...new Set([...uids].filter(Boolean))];
  if (unique.length === 0 || keys.length === 0) return;
  const db = getFirestore();
  try {
    for (let i = 0; i < unique.length; i += 400) {
      const batch = db.batch();
      for (const uid of unique.slice(i, i + 400)) bumpRiderSignalInBatch(db, batch, uid, keys, reason);
      await batch.commit();
    }
  } catch {
    // covered by the fallback refresh
  }
}
