import "../core/init";
import { createRequire } from "node:module";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { HttpsError, onCall, type CallableOptions } from "firebase-functions/v2/https";
import { routerRequirePath } from "./legacy-modules";
import { callableOptionsForLane, laneOf, type LaneId } from "./lanes";

const requireFromRouter = createRequire(__filename);

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

let inflight = 0;

export type RouterAuth = {
  uid: string;
  token?: unknown;
};

export type RouterRequest = {
  data?: unknown;
  auth?: RouterAuth;
};

export type HandlerLoader = (fn: string) => unknown;

export type LoadedHandler = {
  run?: (request: RouterRequest) => unknown;
};

function readFn(request: RouterRequest): string | null {
  const data = request.data;
  if (!data || typeof data !== "object") return null;
  const fn = (data as { fn?: unknown }).fn;
  if (typeof fn !== "string" || fn.length === 0) return null;
  return fn;
}

function unwrapArgs(request: RouterRequest): unknown {
  const data = request.data;
  if (!data || typeof data !== "object" || !("data" in data)) return undefined;
  return (data as { data?: unknown }).data;
}

function toHttps(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  return new HttpsError("internal", "INTERNAL");
}

function writeRouterLog(lane: LaneId, fn: string | null, inFlight: number): void {
  const line = {
    perf: "router",
    lane,
    fn,
    eventLoopDelayP99Ms: Math.round(eventLoopDelay.percentile(99) / 1e6),
    heapUsed: process.memoryUsage().heapUsed,
    inflight: inFlight,
  };
  console.info(JSON.stringify(line));
}

async function invoke(loaded: unknown, request: RouterRequest): Promise<unknown> {
  const inner: RouterRequest = {
    ...request,
    data: unwrapArgs(request),
    auth: request.auth,
  };
  if (typeof loaded === "function") {
    const withRun = loaded as LoadedHandler & ((req: RouterRequest) => unknown);
    if (typeof withRun.run === "function") return await withRun.run(inner);
    return await withRun(inner);
  }
  throw new HttpsError("internal", "INTERNAL");
}

export function loadLegacyHandler(fn: string): unknown {
  const modulePath = routerRequirePath(fn);
  if (!modulePath) return undefined;
  // Cold-start exception to no-inline-imports: lazy require so one lane does not load every RPC module.
  const loaded = requireFromRouter(modulePath) as Record<string, unknown>;
  return loaded[fn];
}

async function runLane(
  lane: LaneId,
  request: RouterRequest,
  fn: string | null,
  load: HandlerLoader,
): Promise<unknown> {
  if (!fn) throw new HttpsError("not-found", "unknown_fn");
  const owner = laneOf(fn);
  if (!owner) throw new HttpsError("not-found", "unknown_fn");
  if (owner !== lane) throw new HttpsError("failed-precondition", "wrong_lane");
  const loaded = load(fn);
  if (loaded == null) throw new HttpsError("internal", "INTERNAL");
  return invoke(loaded, request);
}

export async function dispatchAdminLane(
  lane: LaneId,
  request: RouterRequest,
  load: HandlerLoader = loadLegacyHandler,
): Promise<unknown> {
  inflight += 1;
  const fn = readFn(request);
  try {
    try {
      return await runLane(lane, request, fn, load);
    } catch (err) {
      throw toHttps(err);
    }
  } finally {
    writeRouterLog(lane, fn, inflight);
    inflight -= 1;
  }
}

function buildLane(lane: LaneId) {
  return onCall(callableOptionsForLane(lane) as CallableOptions, (request) =>
    dispatchAdminLane(lane, request),
  );
}

const target = process.env.FUNCTION_TARGET?.trim() ?? "";

export const adminApi = !target || target === "adminApi" ? buildLane("light") : undefined;
export const adminApiScan = !target || target === "adminApiScan" ? buildLane("scan") : undefined;
export const adminApiHeavy = !target || target === "adminApiHeavy" ? buildLane("heavy") : undefined;
