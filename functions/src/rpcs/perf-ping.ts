import { getFirestore } from "../core/fs";
import { measureOnCall } from "../core/fs-metrics";
import { requireStaff } from "../core/staff";

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

/**
 * Temporary read-only probe. Deleted after the last stage's comparison.
 * Returns timings only — no document bodies.
 */
export const adminPerfPing = measureOnCall("adminPerfPing", async (request) => {
  await requireStaff(request);

  const db = getFirestore();
  const settings = db.collection("app_settings").doc("1");
  const sequential: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    const started = Date.now();
    await settings.get();
    sequential.push(Date.now() - started);
  }

  const listed = await db.collection("profiles").limit(20).select().get();
  const refs = listed.docs.map((doc) => doc.ref);
  const batchStarted = Date.now();
  if (refs.length > 0) await db.getAll(...refs);
  const getAllMs = Date.now() - batchStarted;

  const sorted = [...sequential].sort((a, b) => a - b);
  return {
    sequentialP50: percentile(sorted, 50),
    sequentialP95: percentile(sorted, 95),
    sequentialN: sequential.length,
    getAllMs,
    getAllN: refs.length,
  };
});
