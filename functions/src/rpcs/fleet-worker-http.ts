/**
 * HTTPS doors for the dpd-live Worker.
 *
 * The Worker cannot mint a staff ID token. These functions are public
 * invokers gated by `WORKER_SHARED_SECRET` (`X-Worker-Secret`), the same value
 * stored as a Wrangler secret.
 *
 * `workerApi` is the door the Worker uses: one function, one warm instance,
 * serving all three jobs by the last segment of the path
 * (`/workerApi/adminIngestDriverPositions`). The three single-purpose doors
 * are the same handlers under their old addresses, kept as a standby.
 *
 * These doors carry the fleet's GPS burst. They intentionally override the
 * global `cpu: 0.08 / concurrency: 1 / maxInstances: 2` shape: a single-flight
 * door capped at two instances turns a normal rider reconnect wave into 429s,
 * and every refused publish falls back to a Firestore write. Cloud Run rejects
 * concurrent execution below one full CPU, so `cpu: 1` is mandatory here.
 */
import "../core/init";
import { timingSafeEqual } from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { buildDriverSnapshot, buildLiveFleetSnapshot, num, type Dict } from "./fleet";
import { runIngestDriverPositions, runRecordFleetEvents, runRecordRiderDayStats } from "./fleet-ingest";
import { WORKER_HTTP_CAPACITY, WORKER_HTTP_STANDBY_CAPACITY } from "./worker-http-capacity";

export const workerSharedSecret = defineSecret("WORKER_SHARED_SECRET");

const workerHttp = {
  secrets: [workerSharedSecret],
  invoker: "public" as const,
  ...WORKER_HTTP_CAPACITY,
};

const workerHttpStandby = {
  secrets: [workerSharedSecret],
  invoker: "public" as const,
  ...WORKER_HTTP_STANDBY_CAPACITY,
};

type OpsEvent = {
  id: string;
  driver_id: string | null;
  category: string;
  operation_key: string;
  success: boolean;
  error_code: string | null;
  context: Dict;
  occurred_at: string;
};

type WorkerOp = "snapshot" | "driver_snapshot" | "ops";

function readBody(body: unknown): Dict {
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Dict;
    } catch {
      return {};
    }
  }
  if (body && typeof body === "object" && !Array.isArray(body)) return body as Dict;
  return {};
}

function workerAuthorized(header: string | undefined): boolean {
  let expected = "";
  try {
    expected = workerSharedSecret.value();
  } catch {
    return false;
  }
  if (!expected || !header) return false;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function asDict(value: unknown): Dict {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Dict;
}

function parseOp(value: unknown): WorkerOp | null {
  if (value === "snapshot" || value === "driver_snapshot" || value === "ops") return value;
  return null;
}

function mapOps(id: string, data: Dict): OpsEvent | null {
  const occurred = asDate(data.occurred_at);
  if (!occurred) return null;
  return {
    id,
    driver_id: text(data.driver_id),
    category: text(data.category) ?? text(data.module) ?? "",
    operation_key: text(data.operation_key) ?? text(data.action) ?? "",
    success: data.success !== false,
    error_code: text(data.error_code),
    context: Object.keys(asDict(data.context)).length
      ? asDict(data.context)
      : asDict(data.detail),
    occurred_at: occurred.toISOString(),
  };
}

async function listDriverOps(body: Dict): Promise<{
  events: OpsEvent[];
  cursor: { occurred_at: string; id: string };
}> {
  const limit = Math.min(Math.max(Math.trunc(num(body.limit) ?? 200), 1), 200);
  const afterAt = asDate(body.after_occurred_at);
  const afterId = text(body.after_id) ?? "";
  const db = getFirestore();
  const collection = db.collection(COLLECTIONS.driverOperationEvents);

  if (!afterAt) {
    const snap = await collection.orderBy("occurred_at", "desc").limit(limit).get();
    const events = snap.docs
      .map((doc) => mapOps(doc.id, (doc.data() ?? {}) as Dict))
      .filter((row): row is OpsEvent => row !== null)
      .reverse();
    const newest = events[events.length - 1];
    return {
      events,
      cursor: newest
        ? { occurred_at: newest.occurred_at, id: newest.id }
        : { occurred_at: new Date().toISOString(), id: "" },
    };
  }

  const snap = await collection
    .where("occurred_at", ">=", Timestamp.fromDate(afterAt))
    .orderBy("occurred_at", "asc")
    .limit(limit + 20)
    .get();
  const events = snap.docs
    .map((doc) => mapOps(doc.id, (doc.data() ?? {}) as Dict))
    .filter((row): row is OpsEvent => row !== null)
    .filter((row) => {
      const at = new Date(row.occurred_at).getTime();
      if (at > afterAt.getTime()) return true;
      if (at < afterAt.getTime()) return false;
      if (!afterId) return false;
      return row.id > afterId;
    })
    .slice(0, limit);
  const last = events[events.length - 1];
  return {
    events,
    cursor: last
      ? { occurred_at: last.occurred_at, id: last.id }
      : { occurred_at: afterAt.toISOString(), id: afterId },
  };
}

type WorkerResponse = { status: (code: number) => { json: (payload: unknown) => void } };
type WorkerHandler = (body: Dict, res: WorkerResponse) => Promise<void>;

function guarded(handler: WorkerHandler) {
  return onRequest(workerHttpStandby, async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }
    const header = req.header("x-worker-secret") ?? undefined;
    if (!workerAuthorized(header)) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    await handler(readBody(req.body), res);
  });
}

const fleetRead: WorkerHandler = async (body, res) => {
  const op = parseOp(body.op);
  if (!op) {
    res.status(400).json({ ok: false, error: "unknown_op" });
    return;
  }
  switch (op) {
    case "snapshot": {
      const minutes =
        num(body.seen_within_minutes ?? body.seenWithinMinutes ?? body.p_seen_within_minutes) ?? 30;
      res.status(200).json(await buildLiveFleetSnapshot(minutes));
      return;
    }
    /**
     * One rider, read directly.
     *
     * The room calls this when an ingest arrives for a driver it is not holding —
     * a shift that started after the last roster read, or a rider who came back
     * after an eviction. It used to call `snapshot`, which is a whole-fleet answer:
     * every driver plus every delivery of the day, ~6,000-8,000 reads per batch.
     */
    case "driver_snapshot": {
      const driverId = text(body.driver_id ?? body.driverId ?? body.p_driver_id);
      if (!driverId) {
        res.status(400).json({ ok: false, error: "driver_id_required" });
        return;
      }
      const minutes =
        num(body.seen_within_minutes ?? body.seenWithinMinutes ?? body.p_seen_within_minutes) ?? 60;
      const result = await buildDriverSnapshot(driverId, minutes);
      res.status(200).json(result);
      return;
    }
    case "ops": {
      res.status(200).json(await listDriverOps(body));
      return;
    }
    default: {
      const neverOp: never = op;
      res.status(400).json({ ok: false, error: "unknown_op", op: neverOp });
    }
  }
};

const ingestPositions: WorkerHandler = async (body, res) => {
  const dayStats = await runRecordRiderDayStats(body.p_day_stats);
  const result = await runIngestDriverPositions(body.p_events ?? body.events);
  res.status(result.ok ? 200 : 400).json({ ...result, day_stats: dayStats });
};

const recordFleetEvents: WorkerHandler = async (body, res) => {
  const result = await runRecordFleetEvents(body.p_events ?? body.events);
  res.status(result.ok ? 200 : 400).json(result);
};

/** The jobs `workerApi` serves, under the names the Worker has always called. */
export const WORKER_API_HANDLERS: Readonly<Record<string, WorkerHandler>> = {
  workerFleetRead: fleetRead,
  adminIngestDriverPositions: ingestPositions,
  adminRecordFleetEvents: recordFleetEvents,
};

/** `/workerApi/adminIngestDriverPositions` → `adminIngestDriverPositions`. */
export function workerApiTarget(path: string | undefined): string | null {
  const segments = String(path ?? "").split("?")[0].split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  return last && Object.prototype.hasOwnProperty.call(WORKER_API_HANDLERS, last) ? last : null;
}

export const workerApi = onRequest(workerHttp, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  const header = req.header("x-worker-secret") ?? undefined;
  if (!workerAuthorized(header)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  const target = workerApiTarget(req.path);
  if (!target) {
    res.status(404).json({ ok: false, error: "unknown_fn" });
    return;
  }
  await WORKER_API_HANDLERS[target](readBody(req.body), res);
});

export const workerFleetRead = guarded(fleetRead);
export const adminIngestDriverPositions = guarded(ingestPositions);
export const adminRecordFleetEvents = guarded(recordFleetEvents);
