import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";

const EPOCH_COLLECTION = "auth_epochs";
const EPOCH_DOC_ID = "current";

export type EpochKind = "access" | "settings" | "menu";

export type EpochWrite = {
  tx: Transaction;
};

/**
 * One transaction: the caller's writes, then FieldValue.increment(1) on each
 * named counter of auth_epochs/current. Mirrors Next writeWithEpoch. Reads
 * inside `mutate` must happen before its writes. The epoch set runs after.
 */
export async function writeWithEpoch<T>(
  db: Firestore,
  kinds: EpochKind | readonly EpochKind[],
  mutate: (write: EpochWrite) => Promise<T> | T,
): Promise<T> {
  const list = (Array.isArray(kinds) ? kinds : [kinds]) as readonly EpochKind[];
  const epochRef = db.collection(EPOCH_COLLECTION).doc(EPOCH_DOC_ID);
  return db.runTransaction(async (tx) => {
    const result = await mutate({ tx });
    if (list.length > 0) {
      const patch: Record<string, ReturnType<typeof FieldValue.increment>> = {};
      for (const kind of list) patch[kind] = FieldValue.increment(1);
      tx.set(epochRef, patch, { merge: true });
    }
    return result;
  });
}
