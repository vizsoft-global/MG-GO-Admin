/**
 * Drop the cached Order Comparison snapshots.
 *
 * `adminOrderComparisonSnapshot` sits behind the scan lane's five-minute
 * read-through cache (`functions/src/router/read-snapshot.ts`), keyed by the
 * function name, the caller's scope, a generation counter and the arguments.
 * Payroll, HR, attendance and leave writes all bump their own counters — but
 * nothing bumped this one, so committing an AM sheet left the previous result
 * in place for up to five minutes. The operator uploads October and the page
 * still shows whatever it showed before, which reads as "the month filter is
 * broken".
 *
 * The commit path lives in a Next server action rather than a Cloud Function,
 * so it writes the same generation document the router reads. A failure here
 * must never fail the import: the worst case is the old five-minute TTL.
 */
import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

const PAGE_READ_GENERATIONS = "page_read_generations";

export async function bumpOrderComparisonSnapshot(db: Firestore): Promise<void> {
  try {
    await db
      .collection(PAGE_READ_GENERATIONS)
      .doc("current")
      .set(
        {
          adminOrderComparisonSnapshot: FieldValue.increment(1),
          updated_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch {
    // The five-minute TTL still expires the stale copy.
  }
}
