import { AsyncLocalStorage } from "node:async_hooks";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import {
  AggregateQuery,
  DocumentReference,
  Firestore,
  Query,
  Transaction,
} from "firebase-admin/firestore";

/**
 * Per-request Firestore read counters.
 *
 * Logging stays on unless `PERF_METRICS=0`. Setting `PERF_METRICS=1` on the
 * function would be a runtime option change, which Stage A forbids, so the
 * default is to log and the off switch is the only env value we honour.
 */

export type FsMetrics = {
  name: string;
  reads: number;
  docsRead: number;
  sequentialAwaits: number;
  inflight: number;
  active: ActiveRead[];
};

type ActiveRead = { overlapped: boolean };

const storage = new AsyncLocalStorage<FsMetrics>();

let patched = false;

function noteStart(): ActiveRead | null {
  const metrics = storage.getStore();
  if (!metrics) return null;
  const slot: ActiveRead = { overlapped: metrics.inflight > 0 };
  if (metrics.inflight > 0) {
    for (const active of metrics.active) active.overlapped = true;
  }
  metrics.active.push(slot);
  metrics.inflight += 1;
  metrics.reads += 1;
  return slot;
}

function noteEnd(slot: ActiveRead | null, docs: number): void {
  const metrics = storage.getStore();
  if (!metrics || !slot) return;
  metrics.docsRead += docs;
  metrics.inflight = Math.max(0, metrics.inflight - 1);
  metrics.active = metrics.active.filter((active) => active !== slot);
  if (!slot.overlapped) metrics.sequentialAwaits += 1;
}

/** Test seam. Counts one read and whether it overlapped another in-flight read. */
export async function recordRead<T>(
  promise: Promise<T>,
  docs: number | ((value: T) => number),
): Promise<T> {
  const slot = noteStart();
  try {
    const value = await promise;
    const count = typeof docs === "function" ? docs(value) : docs;
    noteEnd(slot, count);
    return value;
  } catch (error) {
    noteEnd(slot, 0);
    throw error;
  }
}

function patchMethod(
  proto: object,
  method: string,
  docsOf: (value: unknown) => number,
): void {
  const host = proto as Record<string, unknown>;
  const original = host[method];
  if (typeof original !== "function") return;
  if ((original as { __perfPatched?: boolean }).__perfPatched) return;

  function wrapped(this: unknown, ...args: unknown[]): unknown {
    const result = (original as (...inner: unknown[]) => unknown).apply(this, args);
    if (!result || typeof (result as Promise<unknown>).then !== "function") return result;
    return recordRead(result as Promise<unknown>, docsOf);
  }
  (wrapped as { __perfPatched?: boolean }).__perfPatched = true;
  host[method] = wrapped;
}

/** Install once. Outside a measured request the wrappers only forward. */
export function installFsMetrics(): void {
  if (patched) return;
  patched = true;
  patchMethod(Query.prototype, "get", (value) => {
    const snap = value as { size?: number };
    return typeof snap.size === "number" ? snap.size : 0;
  });
  patchMethod(DocumentReference.prototype, "get", (value) => {
    const snap = value as { exists?: boolean };
    return snap.exists ? 1 : 0;
  });
  patchMethod(Firestore.prototype, "getAll", (value) => (Array.isArray(value) ? value.length : 0));
  patchMethod(AggregateQuery.prototype, "get", () => 1);
  patchMethod(Transaction.prototype, "get", (value) => {
    if (Array.isArray(value)) return value.length;
    const snap = value as { exists?: boolean; size?: number };
    if (typeof snap.size === "number") return snap.size;
    return snap.exists ? 1 : 0;
  });
}

export async function runWithFsMetrics<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const metrics: FsMetrics = {
    name,
    reads: 0,
    docsRead: 0,
    sequentialAwaits: 0,
    inflight: 0,
    active: [],
  };
  const started = Date.now();
  try {
    return await storage.run(metrics, fn);
  } finally {
    if (process.env.PERF_METRICS !== "0") {
      console.info(
        JSON.stringify({
          perf: "handler",
          name,
          reads: metrics.reads,
          docsRead: metrics.docsRead,
          sequentialAwaits: metrics.sequentialAwaits,
          ms: Date.now() - started,
        }),
      );
    }
  }
}

/** Same global `onCall()` options as a bare `onCall(handler)`. No per-function overrides. */
export function measureOnCall<T>(
  name: string,
  handler: (request: CallableRequest<unknown>) => Promise<T>,
) {
  return onCall((request) => runWithFsMetrics(name, () => handler(request)));
}

export async function measureBlock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<{ result: T; metrics: FsMetrics }> {
  let captured: FsMetrics | null = null;
  const result = await runWithFsMetrics(name, async () => {
    captured = storage.getStore() ?? null;
    return fn();
  });
  if (!captured) throw new Error("metrics_missing");
  return { result, metrics: captured };
}
