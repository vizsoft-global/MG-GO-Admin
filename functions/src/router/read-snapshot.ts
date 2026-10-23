/**
 * Scan-lane read-through cache.
 *
 * The first call still runs the existing handler. The result is stored gzipped
 * under a scope key. The next call with the same arguments reads that document
 * instead of the collection. A failed read or a payload that does not fit falls
 * through to the handler, so a cache problem cannot paint an empty page.
 *
 * Scope is `staff` for a manager, `partner:<project>` for a partner, and
 * `user:<uid>` for a ticked user. A partner never shares a manager's document.
 *
 * `adminLiveFleetSnapshot` is absent from the TTL map on purpose: the map is
 * live, and the Worker `/latest` path is the fast read.
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { FieldValue, Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";

const PACK_LIMIT = 900_000;

export const PAYROLL_SNAPSHOTS = [
  "adminPayrollRuleSnapshot",
  "adminPayrollMonthSnapshot",
  "adminHrPayrollSnapshot",
] as const;

export const ATTENDANCE_SNAPSHOTS = [
  "adminListAttendanceDaily",
  "adminAttendanceKpis",
  ...PAYROLL_SNAPSHOTS,
] as const;

export const OPERATIONS_SNAPSHOTS = [
  "adminOperationsDashboard",
  "adminClientPortalDashboard",
] as const;

/** How long a stored result may be served before the handler runs again. */
export const SNAPSHOT_TTL_MS: Record<string, number> = {
  adminPayrollRuleSnapshot: 5 * 60_000,
  adminPayrollMonthSnapshot: 5 * 60_000,
  adminHrPayrollSnapshot: 5 * 60_000,
  adminOperationsDashboard: 2 * 60_000,
  adminClientPortalDashboard: 2 * 60_000,
  adminListAttendanceDaily: 60_000,
  adminAttendanceKpis: 60_000,
  adminOrderComparisonSnapshot: 5 * 60_000,
  adminPerformanceOpsSnapshot: 5 * 60_000,
  adminListDriversPage: 2 * 60_000,
  adminDriversFilterValues: 5 * 60_000,
  adminEmployeesDashboard: 2 * 60_000,
  adminIncentiveDailyReport: 60_000,
  adminDeliveriesStatusCounts: 60_000,
  adminDeliveriesCountsByFilters: 60_000,
  adminListDriverLevels: 5 * 60_000,
};

export type ScanSnapshotOutcome = "hit" | "miss" | "skip" | "off";

export type SnapshotScopeInput = {
  uid: string;
  isSuperAdmin: boolean;
  isManager: boolean;
  /** Present once partner access is on the staff context. Absent means a staff caller. */
  isPartner?: boolean;
  partnerProjectKey?: string | null;
};

export type StoredSnapshot = {
  packed: Buffer;
  generation: number;
  freshUntil: number;
};

export type ScanSnapshotBackend = {
  generation: (fn: string) => Promise<number>;
  read: (id: string) => Promise<StoredSnapshot | null>;
  write: (id: string, row: StoredSnapshot & { fn: string; scope: string }) => Promise<void>;
};

export function scanSnapshotEnabled(): boolean {
  if (process.env.PAGE_READ_SNAPSHOT === "0") return false;
  return process.env.PAGE_READ_SNAPSHOT === "1" || Boolean(process.env.K_SERVICE);
}

export function snapshotScope(staff: SnapshotScopeInput): string {
  if (staff.isPartner) {
    return staff.partnerProjectKey ? `partner:${staff.partnerProjectKey}` : `user:${staff.uid}`;
  }
  if (staff.isSuperAdmin || staff.isManager) return "staff";
  return `user:${staff.uid}`;
}

export function stableArgs(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableArgs(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableArgs(record[key])}`).join(",")}}`;
}

export function snapshotDocId(fn: string, scope: string, generation: number, args: unknown): string {
  return createHash("sha256").update(`${fn}|${scope}|${generation}|${stableArgs(args)}`).digest("hex");
}

export function packSnapshot(value: unknown): Buffer | null {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return null;
  }
  if (json == null) return null;
  const packed = gzipSync(Buffer.from(json));
  if (packed.length > PACK_LIMIT) return null;
  return packed;
}

export function unpackSnapshot(packed: Buffer): unknown | null {
  try {
    return JSON.parse(gunzipSync(packed).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function asPacked(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function firestoreBackend(): ScanSnapshotBackend {
  const db = () => getFirestore();
  const generations = () => db().collection(COLLECTIONS.pageReadGenerations).doc("current");
  return {
    async generation(fn) {
      const snap = await generations().get();
      const value = snap.get(fn);
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    },
    async read(id) {
      const snap = await db().collection(COLLECTIONS.pageReadSnapshots).doc(id).get();
      if (!snap.exists) return null;
      const packed = asPacked(snap.get("packed"));
      const generation = snap.get("generation");
      const freshUntil = snap.get("fresh_until");
      if (!packed || typeof generation !== "number" || typeof freshUntil !== "number") return null;
      return { packed, generation, freshUntil };
    },
    async write(id, row) {
      await db()
        .collection(COLLECTIONS.pageReadSnapshots)
        .doc(id)
        .set({
          fn: row.fn,
          scope: row.scope,
          generation: row.generation,
          fresh_until: row.freshUntil,
          packed: row.packed,
          expire_at: Timestamp.fromMillis(Date.now() + 24 * 60 * 60_000),
        });
    },
  };
}

export async function readThroughScanSnapshot(
  input: {
    fn: string;
    scope: string;
    args: unknown;
    load: () => Promise<unknown>;
    now?: number;
  },
  backend: ScanSnapshotBackend = firestoreBackend(),
): Promise<{ value: unknown; snapshot: Exclude<ScanSnapshotOutcome, "off"> }> {
  const ttl = SNAPSHOT_TTL_MS[input.fn];
  if (ttl == null) {
    return { value: await input.load(), snapshot: "skip" };
  }
  const now = input.now ?? Date.now();
  let generation = 0;
  try {
    generation = await backend.generation(input.fn);
    const id = snapshotDocId(input.fn, input.scope, generation, input.args);
    const stored = await backend.read(id);
    if (stored && stored.generation === generation && stored.freshUntil > now) {
      const value = unpackSnapshot(stored.packed);
      if (value !== null) return { value, snapshot: "hit" };
    }
  } catch (error) {
    console.error(JSON.stringify({ perf: "snapshot-read-failed", fn: input.fn }));
    void error;
  }

  const value = await input.load();
  try {
    const packed = packSnapshot(value);
    if (packed) {
      const id = snapshotDocId(input.fn, input.scope, generation, input.args);
      await backend.write(id, {
        fn: input.fn,
        scope: input.scope,
        packed,
        generation,
        freshUntil: now + ttl,
      });
    }
  } catch (error) {
    console.error(JSON.stringify({ perf: "snapshot-write-failed", fn: input.fn }));
    void error;
  }
  return { value, snapshot: "miss" };
}

/** One write moves every cached copy of these handlers. The next read recomputes. */
export async function bumpScanSnapshots(names: readonly string[]): Promise<void> {
  if (names.length === 0) return;
  try {
    const patch: Record<string, unknown> = { updated_at: FieldValue.serverTimestamp() };
    for (const name of names) patch[name] = FieldValue.increment(1);
    await getFirestore().collection(COLLECTIONS.pageReadGenerations).doc("current").set(patch, { merge: true });
  } catch (error) {
    console.error(JSON.stringify({ perf: "snapshot-bump-failed", names }));
    void error;
  }
}
