/**
 * HTTPS doors for the dpd-live Worker.
 *
 * The Worker cannot mint a staff ID token. These three functions are public
 * invokers gated by `WORKER_SHARED_SECRET` (`X-Worker-Secret`), the same value
 * stored as a Wrangler secret. Region, CPU, concurrency and max instances come
 * from `core/init` and are not overridden here.
 */
import "../core/init";
import { timingSafeEqual } from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { buildLiveFleetSnapshot, num, type Dict } from "./fleet";
import { runIngestDriverPositions, runRecordFleetEvents } from "./fleet-ingest";

export const workerSharedSecret = defineSecret("WORKER_SHARED_SECRET");

const workerHttp = {
  secrets: [workerSharedSecret],
  invoker: "public" as const,
  timeoutSeconds: 120,
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

type WorkerOp = "snapshot" | "ops";

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
  if (value === "snapshot" || value === "ops") return value;
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

function guarded(
  handler: (body: Dict, res: { status: (code: number) => { json: (payload: unknown) => void } }) => Promise<void>,
) {
  return onRequest(workerHttp, async (req, res) => {
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

export const workerFleetRead = guarded(async (body, res) => {
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
    case "ops": {
      res.status(200).json(await listDriverOps(body));
      return;
    }
    default: {
      const neverOp: never = op;
      res.status(400).json({ ok: false, error: "unknown_op", op: neverOp });
    }
  }
});

export const adminIngestDriverPositions = guarded(async (body, res) => {
  const result = await runIngestDriverPositions(body.p_events ?? body.events);
  res.status(result.ok ? 200 : 400).json(result);
});

export const adminRecordFleetEvents = guarded(async (body, res) => {
  const result = await runRecordFleetEvents(body.p_events ?? body.events);
  res.status(result.ok ? 200 : 400).json(result);
});
