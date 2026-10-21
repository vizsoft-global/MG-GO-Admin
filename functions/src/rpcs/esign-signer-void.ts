import { Timestamp, type Firestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { chunk, dataOf, type Dict } from "./_shared";

/**
 * A signer row on a request that can no longer be signed.
 *
 * `void` is deliberately not `expired`: expiry is a due-date outcome for the
 * rider's own row, while a void row is a staff assignment the request itself
 * cancelled (the rider declined, or the request timed out). Every reader already
 * filters `status === "pending"`, so a void row is ignored by the inbox, by
 * `counterSignatureState` and by the compose's `awaiting_counter_signature`
 * check — which is what stops a dead request from holding the counter-signature
 * lock open forever.
 */
export const SIGNER_STATUS_VOID = "void";

type SignerRow = { id: string; data: Dict };

function isStaffRow(row: Dict): boolean {
  const staffId = row["staff_user_id"];
  return typeof staffId === "string" && staffId.trim() !== "";
}

/** The staff rows a terminal request must release. Pure, so it is testable. */
export function pendingStaffSignerIds(rows: readonly SignerRow[]): string[] {
  return rows
    .filter(({ data }) => data["status"] === "pending" && isStaffRow(data))
    .map(({ id }) => id);
}

/** Releases every staff signer still waiting on `requestId`. Returns the count. */
export async function voidPendingStaffSigners(
  db: Firestore,
  requestId: string,
  reason: string,
): Promise<number> {
  let rows: SignerRow[];
  try {
    const snap = await db
      .collection(COLLECTIONS.esignRequestSigners)
      .where("request_id", "==", requestId)
      .get();
    rows = snap.docs.map((doc) => ({ id: doc.id, data: dataOf(doc) }));
  } catch (error) {
    // Voiding is housekeeping: it must never undo the decline that triggered it.
    console.error("esign signer void read", requestId, error);
    return 0;
  }

  const ids = pendingStaffSignerIds(rows);
  if (ids.length === 0) return 0;

  const stamp = Timestamp.now();
  try {
    for (const group of chunk(ids, 400)) {
      const batch = db.batch();
      for (const id of group) {
        batch.update(db.collection(COLLECTIONS.esignRequestSigners).doc(id), {
          status: SIGNER_STATUS_VOID,
          voided_at: stamp,
          void_reason: reason,
          updated_at: stamp,
        });
      }
      await batch.commit();
    }
  } catch (error) {
    console.error("esign signer void write", requestId, error);
    return 0;
  }
  return ids.length;
}
