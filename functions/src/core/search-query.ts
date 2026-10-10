import { getFirestore, type Firestore } from "./fs";
import { prefixBounds } from "./search-text";

const PER_FIELD_LIMIT = 200;

/** True once any document in the collection has stored the lowercase field. */
export async function lowercaseFieldIndexed(
  db: Firestore,
  collection: string,
  field: string,
): Promise<boolean> {
  const snap = await db.collection(collection).orderBy(field).limit(1).get();
  return !snap.empty;
}

export async function prefixMatchIds(
  db: Firestore,
  collection: string,
  queries: readonly { field: string; term: string }[],
): Promise<string[]> {
  const seen = new Set<string>();
  const jobs = queries.filter((query) => {
    const key = `${query.field}:${query.term}`;
    if (!query.term || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (jobs.length === 0) return [];

  const snaps = await Promise.all(
    jobs.map((query) => {
      const bounds = prefixBounds(query.term);
      if (!bounds) return Promise.resolve(null);
      return db
        .collection(collection)
        .where(query.field, ">=", bounds.start)
        .where(query.field, "<=", bounds.end)
        .limit(PER_FIELD_LIMIT)
        .get();
    }),
  );

  const ids = new Set<string>();
  for (const snap of snaps) {
    if (!snap) continue;
    for (const doc of snap.docs) ids.add(doc.id);
  }
  return [...ids];
}

export function firestore(): Firestore {
  return getFirestore();
}
