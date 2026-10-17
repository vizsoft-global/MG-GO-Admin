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
let disabled = false;

/** A Firestore class export. Missing at runtime on some Admin SDK builds. */
type ProtoCtor = { prototype?: object } | undefined;

export type FsMetricClasses = {
  Query?: ProtoCtor;
  DocumentReference?: ProtoCtor;
  Firestore?: ProtoCtor;
  AggregateQuery?: ProtoCtor;
  Transaction?: ProtoCtor;
};

function defaultClasses(): FsMetricClasses {
  return {
    Query,
    DocumentReference,
    Firestore,
    AggregateQuery: AggregateQuery as FsMetricClasses["AggregateQuery"],
    Transaction,
  };
}

let loadClasses: () => FsMetricClasses = defaultClasses;

function prototypeOf(ctor: unknown): object | null {
  if (typeof ctor !== "function") return null;
  const proto = (ctor as { prototype?: unknown }).prototype;
  if (!proto || typeof proto !== "object") return null;
  return proto;
}

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

function docsOfSnapshot(value: unknown): number {
  const snap = value as { exists?: boolean; size?: number };
  if (typeof snap.size === "number") return snap.size;
  return snap.exists ? 1 : 0;
}

/**
 * Install once. A missing class (AggregateQuery on some builds) is skipped.
 * Any throw disables metrics for this process and is logged once. Callers
 * never see that error. Outside a measured request the wrappers only forward.
 */
export function installFsMetrics(): void {
  if (patched || disabled) return;
  try {
    const classes = loadClasses();
    const query = prototypeOf(classes.Query);
    if (query) {
      patchMethod(query, "get", (value) => {
        const snap = value as { size?: number };
        return typeof snap.size === "number" ? snap.size : 0;
      });
    }
    const document = prototypeOf(classes.DocumentReference);
    if (document) {
      patchMethod(document, "get", (value) => {
        const snap = value as { exists?: boolean };
        return snap.exists ? 1 : 0;
      });
    }
    const firestore = prototypeOf(classes.Firestore);
    if (firestore) {
      patchMethod(firestore, "getAll", (value) => (Array.isArray(value) ? value.length : 0));
    }
    const aggregate = prototypeOf(classes.AggregateQuery);
    if (aggregate) patchMethod(aggregate, "get", () => 1);
    const transaction = prototypeOf(classes.Transaction);
    if (transaction) patchMethod(transaction, "get", docsOfSnapshot);
    patched = true;
  } catch (error) {
    disabled = true;
    const message = error instanceof Error ? error.message : "install failed";
    console.error(`fs-metrics disabled: ${message}`);
  }
}

/** Test seam. Production always uses the firebase-admin exports. */
export function setFsMetricsClassesForTests(loader: (() => FsMetricClasses) | null): void {
  patched = false;
  disabled = false;
  loadClasses = loader ?? defaultClasses;
}

type Captured<T> = { result: T; metrics: FsMetrics; ms: number };

/**
 * Reads inside `fn` land on this counter only. Totals are added to the
 * enclosing counter on the way out, so a `measureBlock` inside a measured
 * handler still shows up in the handler's own `docsRead`.
 */
async function runCaptured<T>(name: string, fn: () => Promise<T>): Promise<Captured<T>> {
  const parent = storage.getStore() ?? null;
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
    const result = await storage.run(metrics, fn);
    return { result, metrics, ms: Date.now() - started };
  } finally {
    if (parent) {
      parent.reads += metrics.reads;
      parent.docsRead += metrics.docsRead;
    }
  }
}

function logMetrics(payload: Record<string, unknown>): void {
  if (process.env.PERF_METRICS === "0") return;
  console.info(JSON.stringify(payload));
}

export async function runWithFsMetrics<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const { result, metrics, ms } = await runCaptured(name, fn);
  logMetrics({
    perf: "handler",
    name,
    reads: metrics.reads,
    docsRead: metrics.docsRead,
    sequentialAwaits: metrics.sequentialAwaits,
    ms,
  });
  return result;
}

/** Same global `onCall()` options as a bare `onCall(handler)`. No per-function overrides. */
export function measureOnCall<T>(
  name: string,
  handler: (request: CallableRequest<unknown>) => Promise<T>,
) {
  return onCall((request) => runWithFsMetrics(name, () => handler(request)));
}

/**
 * One named step inside a handler. The step gets its own `perf:"block"` line so
 * a single Home call can be split into "which helper read how much" without a
 * second deploy, and its totals still land on the enclosing handler counter.
 */
export async function measureBlock<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<{ result: T; metrics: FsMetrics }> {
  const { result, metrics, ms } = await runCaptured(`block:${name}`, fn);
  logMetrics({
    perf: "block",
    name,
    reads: metrics.reads,
    docsRead: metrics.docsRead,
    sequentialAwaits: metrics.sequentialAwaits,
    ms,
  });
  return { result, metrics };
}
