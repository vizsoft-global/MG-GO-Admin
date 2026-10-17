import "server-only";

import { Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";

export type AdminCostSampleKind = "callable" | "page" | "read";

const SAMPLE_RETENTION_MS = 30 * 86_400_000;

/** `ADMIN_COST_AUDIT_SAMPLE` in [0, 1]; 0 or unset keeps the audit off and writes nothing. */
export function adminCostSampleRate(raw = process.env.ADMIN_COST_AUDIT_SAMPLE): number {
  const rate = Number(raw ?? "0");
  return Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : 0;
}

function kuwaitDay(at: Date): string {
  return new Date(at.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * One sampled row per admin read. `weight` is 1 / rate so
 * `scripts/admin-cost-audit.mjs` can scale samples back to calls per day.
 * Fire-and-forget: never awaited by a read path, never throws.
 */
export function sampleAdminCost(
  kind: AdminCostSampleKind,
  name: string,
  ms: number | null = null,
  random: () => number = Math.random,
): void {
  const rate = adminCostSampleRate();
  if (rate <= 0 || random() >= rate) return;
  const now = new Date();
  void (async () => {
    try {
      const db = await staffDb();
      if (!db) return;
      await db.collection(COLLECTIONS.adminCostSamples).add({
        kind,
        name: name.slice(0, 120),
        ms,
        weight: 1 / rate,
        day: kuwaitDay(now),
        at: Timestamp.fromDate(now),
        expire_at: Timestamp.fromMillis(now.getTime() + SAMPLE_RETENTION_MS),
      });
    } catch {
      /* best-effort */
    }
  })();
}
