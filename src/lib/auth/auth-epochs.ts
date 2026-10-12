import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { AUTH_EPOCHS_DOC_ID, type EpochKind } from "@/lib/auth/epoch-cache";
import { COLLECTIONS } from "@/lib/firebase/db";

export type EpochWrite = {
  tx: Transaction;
  /** Claim that is already taken must not bump a counter. */
  skipEpoch: () => void;
};

/**
 * One transaction: the caller's writes, then FieldValue.increment(1) on each
 * named counter of auth_epochs/current. Reads inside `mutate` must happen
 * before its writes (Firestore rule). The epoch set runs after `mutate`.
 */
export async function writeWithEpoch<T>(
  db: Firestore,
  kinds: EpochKind | readonly EpochKind[],
  mutate: (write: EpochWrite) => Promise<T> | T,
): Promise<T> {
  const list = (Array.isArray(kinds) ? kinds : [kinds]) as readonly EpochKind[];
  return db.runTransaction(async (tx) => {
    let skip = false;
    const result = await mutate({
      tx,
      skipEpoch: () => {
        skip = true;
      },
    });
    if (!skip && list.length > 0) {
      const patch: Record<string, ReturnType<typeof FieldValue.increment>> = {};
      for (const kind of list) {
        patch[kind] = FieldValue.increment(1);
      }
      tx.set(db.collection(COLLECTIONS.authEpochs).doc(AUTH_EPOCHS_DOC_ID), patch, {
        merge: true,
      });
    }
    return result;
  });
}
