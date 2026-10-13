/**
 * Rider client telemetry — port of `driver_ingest_telemetry` /
 * `_telemetry_sanitize_context` (`20260911100100`).
 *
 * Returns a result object instead of raising so the app can tell "drop this
 * event" from "retry later". `driver_id` is always the rider JWT.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireRider } from "../core/rider";
import { numberOrNull, pick, type Dict } from "./_shared";

const MAX_BATCH = 100;
const MAX_CONTEXT_CHARS = 1024;
const CLOCK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PER_HOUR = 2000;
const APP_SETTINGS_DOC_ID = "1";
const EVENT_TYPES_COLLECTION = "driver_telemetry_event_types";

const BANNED_SUBSTRING =
  /(token|password|passcode|secret|bearer|jwt|refresh|phone|mobile|msisdn|civil|national_id|iqama|address|street|email|stack|traceback|message|cookie|payload|header|body|auth)/;
const BANNED_NAME_WORD = /(^|_)(pin|otp|lat|lng|latitude|longitude|iban|dob)(_|$)/;
const IDENTIFIER_KEYS = new Set([
  "screen",
  "from_screen",
  "action",
  "code",
  "queue",
  "reason",
  "result",
  "status",
  "network_state",
]);
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const MAX_CONTEXT_STRING = 120;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TelemetryEventType = {
  category: string;
  is_active: boolean;
  context_keys: readonly string[];
};

export const SEEDED_TELEMETRY_EVENT_TYPES: Readonly<Record<string, TelemetryEventType>> = {
  "app.startup": { category: "lifecycle", is_active: true, context_keys: ["cold_start", "boot_ms"] },
  "app.foreground": { category: "lifecycle", is_active: true, context_keys: ["screen", "duration_ms"] },
  "app.background": { category: "lifecycle", is_active: true, context_keys: ["screen", "duration_ms"] },
  "app.client_info": {
    category: "lifecycle",
    is_active: true,
    context_keys: ["platform", "os_version", "device_model", "app_version_name", "app_version_code", "locale"],
  },
  "screen.open": { category: "screen", is_active: true, context_keys: ["screen", "from_screen", "load_ms"] },
  "action.tap": { category: "action", is_active: true, context_keys: ["action", "screen", "result"] },
  "permission.location_granted": {
    category: "permission",
    is_active: true,
    context_keys: ["status", "screen", "is_permanent", "attempt"],
  },
  "permission.location_denied": {
    category: "permission",
    is_active: true,
    context_keys: ["status", "screen", "is_permanent", "attempt"],
  },
  "permission.notification_granted": {
    category: "permission",
    is_active: true,
    context_keys: ["status", "screen", "is_permanent", "attempt"],
  },
  "permission.notification_denied": {
    category: "permission",
    is_active: true,
    context_keys: ["status", "screen", "is_permanent", "attempt"],
  },
  "permission.camera_denied": {
    category: "permission",
    is_active: true,
    context_keys: ["status", "screen", "is_permanent", "attempt"],
  },
  "network.offline": { category: "network", is_active: true, context_keys: ["network_state", "offline_ms"] },
  "network.online": { category: "network", is_active: true, context_keys: ["network_state", "offline_ms"] },
  "queue.created": { category: "queue", is_active: true, context_keys: ["queue", "depth", "dropped", "reason"] },
  "queue.flushed": {
    category: "queue",
    is_active: true,
    context_keys: ["queue", "depth", "batch_count", "flush_ms", "reason"],
  },
  "client.error": {
    category: "client_error",
    is_active: true,
    context_keys: ["code", "screen", "http_status", "retryable"],
  },
};

export type TelemetryReject = { event_id: string | null; reason: string };

export type StagedTelemetryEvent = {
  event_id: string;
  event_name: string;
  category: string;
  client_ts: Date;
  clock_skew_ms: number;
  session_id: string | null;
  correlation_id: string | null;
  platform: string | null;
  app_version_name: string | null;
  app_version_code: number | null;
  network_state: string | null;
  severity: "info" | "warn" | "error";
  context: Dict;
  stripped: number;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function left(value: unknown, max: number): string | null {
  const text = asString(value);
  return text ? text.slice(0, max) : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function parseClientTs(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/**
 * Four rules, in order, matching `_telemetry_sanitize_context`:
 * allowlist → denylist → scalars only → value bounds.
 */
export function sanitizeTelemetryContext(
  raw: unknown,
  allowedKeys: readonly string[],
): { context: Dict; stripped: number } {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { context: {}, stripped: 0 };
  }
  const allowed = new Set(allowedKeys);
  const out: Dict = {};
  let stripped = 0;
  for (const [key, value] of Object.entries(raw as Dict)) {
    if (!allowed.has(key)) {
      stripped += 1;
      continue;
    }
    const name = key.toLowerCase();
    if (BANNED_SUBSTRING.test(name) || BANNED_NAME_WORD.test(name)) {
      stripped += 1;
      continue;
    }
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      stripped += 1;
      continue;
    }
    if (typeof value === "string") {
      if (IDENTIFIER_KEYS.has(key) && !IDENTIFIER_PATTERN.test(value)) {
        stripped += 1;
        continue;
      }
      out[key] = value.slice(0, MAX_CONTEXT_STRING);
      continue;
    }
    out[key] = value;
  }
  return { context: out, stripped };
}

export function pickTelemetryEvents(data: unknown): unknown {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    return pick(data as Dict, "p_events", "events", "batch");
  }
  return undefined;
}

export function stageTelemetryItems(
  items: unknown[],
  args: {
    now: Date;
    types: Readonly<Record<string, TelemetryEventType>>;
    fallbackVersionCode: number | null;
  },
): { staged: StagedTelemetryEvent[]; rejects: TelemetryReject[] } {
  const staged: StagedTelemetryEvent[] = [];
  const rejects: TelemetryReject[] = [];

  for (const raw of items) {
    const item = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Dict) : {};
    const eventIdRaw = item["event_id"];
    const eventId = isUuid(eventIdRaw) ? String(eventIdRaw).trim() : null;
    const clientTs = parseClientTs(item["client_ts"]);
    const name = asString(item["event_name"]);

    if (!eventId || !clientTs || !name) {
      rejects.push({
        event_id: typeof eventIdRaw === "string" ? eventIdRaw : eventId,
        reason: "invalid_event",
      });
      continue;
    }

    const type = args.types[name];
    if (!type) {
      rejects.push({ event_id: eventId, reason: "unknown_event_name" });
      continue;
    }
    if (!type.is_active) {
      rejects.push({ event_id: eventId, reason: "event_name_inactive" });
      continue;
    }

    const delta = clientTs.getTime() - args.now.getTime();
    if (Math.abs(delta) > CLOCK_WINDOW_MS) {
      rejects.push({ event_id: eventId, reason: "client_ts_out_of_range" });
      continue;
    }

    const sanitized = sanitizeTelemetryContext(item["context"], type.context_keys);
    if (JSON.stringify(sanitized.context).length > MAX_CONTEXT_CHARS) {
      rejects.push({ event_id: eventId, reason: "context_too_large" });
      continue;
    }

    let severity = String(item["severity"] ?? "info").toLowerCase();
    if (severity !== "info" && severity !== "warn" && severity !== "error") {
      severity = "info";
    }
    if (name === "client.error") severity = "error";

    staged.push({
      event_id: eventId,
      event_name: name,
      category: type.category,
      client_ts: clientTs,
      clock_skew_ms: Math.trunc(delta),
      session_id: left(item["session_id"], 64),
      correlation_id: left(item["correlation_id"], 64),
      platform: left(item["platform"], 16),
      app_version_name: left(item["app_version_name"], 32),
      app_version_code: numberOrNull(item["app_version_code"]) ?? args.fallbackVersionCode,
      network_state: left(item["network_state"], 16),
      severity: severity as StagedTelemetryEvent["severity"],
      context: sanitized.context,
      stripped: Math.min(sanitized.stripped, 32767),
    });
  }

  return { staged, rejects };
}

function telemetryFail(error: string): Dict {
  return { ok: false, error };
}

function telemetryOk(args: {
  accepted: number;
  duplicates: number;
  rejected: number;
  throttled: boolean;
  rejects: TelemetryReject[];
}): Dict {
  return {
    ok: true,
    accepted: args.accepted,
    duplicates: args.duplicates,
    rejected: args.rejected,
    throttled: args.throttled,
    rejects: args.rejects,
  };
}

async function riderForTelemetry(request: Parameters<typeof requireRider>[0]) {
  try {
    return { ok: true as const, ctx: await requireRider(request) };
  } catch (err) {
    if (err instanceof HttpsError) {
      if (err.code === "unauthenticated") return { ok: false as const, error: "not_authenticated" };
      return { ok: false as const, error: "not_a_driver" };
    }
    throw err;
  }
}

function mergeEventTypes(
  seeded: Readonly<Record<string, TelemetryEventType>>,
  overlays: Map<string, Dict>,
): Record<string, TelemetryEventType> {
  const out: Record<string, TelemetryEventType> = { ...seeded };
  for (const [name, raw] of overlays) {
    const keys = Array.isArray(raw["context_keys"])
      ? raw["context_keys"].filter((key: unknown): key is string => typeof key === "string")
      : seeded[name]?.context_keys ?? [];
    out[name] = {
      category: asString(raw["category"]) ?? seeded[name]?.category ?? "lifecycle",
      is_active: raw["is_active"] !== false,
      context_keys: keys,
    };
  }
  return out;
}

async function loadEventTypeOverlays(names: readonly string[]): Promise<Map<string, Dict>> {
  const unique = [...new Set(names.filter(Boolean))];
  const out = new Map<string, Dict>();
  if (unique.length === 0) return out;
  const db = getFirestore();
  const snaps = await db.getAll(
    ...unique.slice(0, 100).map((name) => db.collection(EVENT_TYPES_COLLECTION).doc(name)),
  );
  for (const snap of snaps) {
    if (snap.exists) out.set(snap.id, (snap.data() ?? {}) as Dict);
  }
  return out;
}

export const driverIngestTelemetry = onCall(async (request) => {
  const rider = await riderForTelemetry(request);
  if (!rider.ok) return telemetryFail(rider.error);

  const rawEvents = pickTelemetryEvents(request.data);
  if (rawEvents == null || !Array.isArray(rawEvents)) {
    return telemetryFail("invalid_payload");
  }
  if (rawEvents.length > MAX_BATCH) {
    return telemetryFail("batch_too_large");
  }
  if (rawEvents.length === 0) {
    return telemetryOk({ accepted: 0, duplicates: 0, rejected: 0, throttled: false, rejects: [] });
  }

  const now = new Date();
  const db = getFirestore();
  const settingsSnap = await db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get();
  const maxHour =
    numberOrNull((settingsSnap.data() ?? {})["driver_telemetry_max_events_per_hour"]) ?? DEFAULT_MAX_PER_HOUR;

  const hourAgo = Timestamp.fromDate(new Date(now.getTime() - 60 * 60 * 1000));
  const recent = await db
    .collection(COLLECTIONS.driverTelemetryEvents)
    .where("driver_id", "==", rider.ctx.uid)
    .where("server_received_at", ">", hourAgo)
    .count()
    .get();
  if (recent.data().count >= maxHour) {
    return telemetryOk({ accepted: 0, duplicates: 0, rejected: 0, throttled: true, rejects: [] });
  }

  const names = rawEvents
    .map((item) =>
      item && typeof item === "object" && !Array.isArray(item) ? asString((item as Dict)["event_name"]) : null,
    )
    .filter((name): name is string => name !== null);
  const types = mergeEventTypes(SEEDED_TELEMETRY_EVENT_TYPES, await loadEventTypeOverlays(names));
  const fallbackVersion =
    numberOrNull(rider.ctx.driver["current_app_version_code"]) ??
    numberOrNull(rider.ctx.driver["app_version_code"]);
  const { staged, rejects } = stageTelemetryItems(rawEvents, {
    now,
    types,
    fallbackVersionCode: fallbackVersion,
  });

  if (staged.length === 0) {
    return telemetryOk({
      accepted: 0,
      duplicates: 0,
      rejected: rejects.length,
      throttled: false,
      rejects,
    });
  }

  const refs = staged.map((event) =>
    db.collection(COLLECTIONS.driverTelemetryEvents).doc(`${rider.ctx.uid}_${event.event_id}`),
  );
  const existing = await db.getAll(...refs);
  const deviceId = asString(rider.ctx.driver["active_device_id"]);
  const stamp = Timestamp.fromDate(now);
  const batch = db.batch();
  let inserted = 0;
  for (let index = 0; index < staged.length; index += 1) {
    const snap = existing[index];
    if (snap?.exists) continue;
    const event = staged[index];
    const ref = refs[index];
    if (!event || !ref) continue;
    batch.set(ref, {
      driver_id: rider.ctx.uid,
      event_id: event.event_id,
      event_name: event.event_name,
      category: event.category,
      client_ts: Timestamp.fromDate(event.client_ts),
      server_received_at: stamp,
      clock_skew_ms: event.clock_skew_ms,
      session_id: event.session_id,
      correlation_id: event.correlation_id,
      platform: event.platform,
      app_version_name: event.app_version_name,
      app_version_code: event.app_version_code,
      device_id: deviceId,
      network_state: event.network_state,
      severity: event.severity,
      context: event.context,
      context_stripped_keys: event.stripped,
    });
    inserted += 1;
  }
  if (inserted > 0) await batch.commit();

  return telemetryOk({
    accepted: inserted,
    duplicates: staged.length - inserted,
    rejected: rejects.length,
    throttled: false,
    rejects,
  });
});
