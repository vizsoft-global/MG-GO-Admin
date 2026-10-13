/**
 * Rider profile leftovers — `driver_update_avatar` (`20260908160000`) and
 * `driver_report_device_meta` (`20261016100000`).
 *
 * Avatar stamps R2 object keys only; the bytes are already in the bucket.
 * Device meta is a heartbeat that never raises.
 */
import { onCall } from "firebase-functions/v2/https";
import { Timestamp, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireRider, riderError } from "../core/rider";
import {
  isoTimestamp,
  logDriverOperation,
  numberOrNull,
  pickBoolean,
  pickObject,
  pickText,
  type Dict,
} from "./_shared";

const LOGIN_VERIFICATIONS = "driver_login_verifications";

const APP_SETTINGS_DOC_ID = "1";
const DEFAULT_FORCE_MESSAGE = "A new version of the app is required to continue.";
const SESSION_SCAN = 20;

const DEVICE_META_ALLOWED = [
  "model",
  "manufacturer",
  "brand",
  "hardware",
  "board",
  "soc_model",
  "soc_manufacturer",
  "cpu_cores",
  "ram_total_mb",
  "ram_free_mb",
  "is_low_ram",
  "os_version",
  "android_sdk_int",
  "android_security_patch",
  "supported_abis",
  "is_physical_device",
  "battery_pct",
  "battery_health",
  "battery_temp_c",
  "charging_state",
  "app_version_name",
  "app_version_code",
  "locale",
  "collected_at",
] as const;

const BATTERY_HEALTH = new Set([
  "good",
  "overheat",
  "dead",
  "over_voltage",
  "cold",
  "failure",
  "unknown",
]);
const CHARGING_STATE = new Set(["charging", "full", "discharging", "unknown"]);
const INT_META_KEYS = new Set([
  "cpu_cores",
  "ram_total_mb",
  "ram_free_mb",
  "android_sdk_int",
  "battery_pct",
  "app_version_code",
]);

export type AvatarKeyVerdict = "ok" | "path_traversal" | "outside_own_prefix";

export function classifyAvatarKey(driverId: string, objectKey: string | null): AvatarKeyVerdict {
  if (objectKey == null) return "ok";
  if (objectKey.includes("..")) return "path_traversal";
  const adminKey = new RegExp(`^drivers/${driverId}/avatar\\.[a-z0-9]+$`, "i");
  if (objectKey.startsWith(`driver-avatars/${driverId}/`) || adminKey.test(objectKey)) {
    return "ok";
  }
  return "outside_own_prefix";
}

/** Port of `_device_meta_sanitize`. */
export function sanitizeReportDeviceMeta(raw: unknown): Dict {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Dict;
  const out: Dict = {};
  for (const key of DEVICE_META_ALLOWED) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    if (value == null) continue;

    if (key === "supported_abis") {
      if (!Array.isArray(value)) continue;
      const items: string[] = [];
      for (const item of value) {
        if (typeof item !== "string") continue;
        const text = item.trim().slice(0, 32);
        if (text !== "" && items.length < 8) items.push(text);
      }
      if (items.length > 0) out[key] = items;
      continue;
    }

    if (key === "is_low_ram" || key === "is_physical_device") {
      if (typeof value === "boolean") out[key] = value;
      continue;
    }

    if (INT_META_KEYS.has(key)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        if (value === Math.trunc(value) && value >= 0 && value < 100_000_000) {
          out[key] = Math.trunc(value);
        }
      }
      continue;
    }

    if (key === "battery_temp_c") {
      if (typeof value === "number" && Number.isFinite(value) && value > -50 && value < 120) {
        out[key] = Math.round(value * 10) / 10;
      }
      continue;
    }

    if (typeof value !== "string") continue;
    let text = value.trim().slice(0, 120);
    if (text === "" || text.toLowerCase() === "unknown" || text.toLowerCase() === "null") {
      continue;
    }
    if (key === "battery_health") {
      text = text.toLowerCase();
      if (!BATTERY_HEALTH.has(text)) continue;
    }
    if (key === "charging_state") {
      text = text.toLowerCase();
      if (!CHARGING_STATE.has(text)) continue;
    }
    out[key] = text;
  }
  return out;
}

export function forceUpdateFromDriver(
  driver: Dict,
  reportedCode: number | null,
  message: string,
): { clear: boolean; payload: Dict | null } {
  const forceAt = driver["force_app_update_at"];
  const forceMin = numberOrNull(driver["force_app_update_min_code"]);
  if (forceAt == null || forceMin == null) return { clear: false, payload: null };
  if (reportedCode != null && reportedCode >= forceMin) {
    return { clear: true, payload: null };
  }
  return { clear: false, payload: { min_version_code: forceMin, message } };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

async function rejectAvatarKey(uid: string, reason: "path_traversal" | "outside_own_prefix"): Promise<never> {
  await logDriverOperation({
    driverId: uid,
    module: "security",
    action: "security.avatar_key_rejected",
    actor: "driver_update_avatar",
    success: false,
    recordType: "driver",
    recordId: uid,
    detail: { reason },
  });
  throw riderError("invalid-argument", "invalid_object_key", { reason });
}

export const driverUpdateAvatar = onCall(async (request) => {
  const rider = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const key = pickText(data, "p_object_key", "object_key", "objectKey");

  const verdict = classifyAvatarKey(rider.uid, key);
  if (verdict === "path_traversal") await rejectAvatarKey(rider.uid, verdict);
  if (verdict === "outside_own_prefix") await rejectAvatarKey(rider.uid, verdict);

  const db = getFirestore();
  const now = Timestamp.now();
  const batch = db.batch();
  batch.set(
    db.collection(COLLECTIONS.drivers).doc(rider.uid),
    {
      avatar_object_key: key,
      avatar_updated_at: now,
      updated_at: now,
    },
    { merge: true },
  );
  batch.set(
    db.collection(COLLECTIONS.profiles).doc(rider.uid),
    {
      avatar_url: key,
      updated_at: now,
    },
    { merge: true },
  );

  const intakes = await db
    .collection(COLLECTIONS.driverIntakes)
    .where("linked_profile_id", "==", rider.uid)
    .limit(SESSION_SCAN)
    .get();
  for (const doc of intakes.docs) {
    batch.set(doc.ref, { avatar_url: key, updated_at: now }, { merge: true });
  }
  await batch.commit();

  await logDriverOperation({
    driverId: rider.uid,
    module: "profile",
    action: "profile.avatar",
    actor: "driver_update_avatar",
    success: true,
    recordType: "driver",
    recordId: rider.uid,
    detail: { cleared: key == null },
  });

  return {
    ok: true,
    avatar_object_key: key,
    avatar_updated_at: isoTimestamp(now),
  };
});

/**
 * Flutter `device_profile_reporter` still calls `driver_report_device_meta`.
 * `driverRecordAppVersion` (driver-devices.ts) writes `drivers`, not the
 * session heartbeat + force_update payload this RPC returns — do not collapse
 * them.
 */
export const driverReportDeviceMeta = onCall(async (request) => {
  try {
    if (!request.auth?.uid) return { updated: false };
    const rider = await requireRider(request);
    const data = (request.data ?? {}) as Dict;
    const deviceId = pickText(data, "p_device_id", "device_id", "deviceId");
    if (!deviceId) return { updated: false };

    const meta = sanitizeReportDeviceMeta(pickObject(data, "p_meta", "meta", "device_meta") ?? {});
    const code = numberOrNull(meta["app_version_code"]);
    const name = asString(meta["app_version_name"]);
    const model = asString(meta["model"]);
    const manufacturer = asString(meta["manufacturer"]);
    const osVersion = asString(meta["os_version"]);
    const sdk = numberOrNull(meta["android_sdk_int"]);
    const emptyMeta = Object.keys(meta).length === 0;

    const db = getFirestore();
    const now = Timestamp.now();
    const sessions = await db
      .collection(COLLECTIONS.driverDeviceSessions)
      .where("driver_id", "==", rider.uid)
      .where("device_id", "==", deviceId)
      .limit(SESSION_SCAN)
      .get();

    let updated = false;
    const write = db.batch();
    for (const doc of sessions.docs) {
      const row = (doc.data() ?? {}) as Dict;
      if (row["revoked_at"] != null) continue;
      const patch: Dict = {
        last_seen_at: now,
        updated_at: now,
      };
      if (code != null) patch["app_version_code"] = code;
      if (name) patch["app_version_name"] = name;
      if (model) patch["device_model"] = model;
      if (manufacturer) patch["device_manufacturer"] = manufacturer;
      if (osVersion) patch["os_version"] = osVersion;
      if (sdk != null) patch["android_sdk_int"] = sdk;
      if (!emptyMeta) {
        patch["device_meta"] = meta;
        patch["device_meta_at"] = now;
      }
      write.set(doc.ref, patch, { merge: true });
      updated = true;
    }
    if (updated) await write.commit();

    const settings = (
      (await db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get()).data() ?? {}
    ) as Dict;
    const message = asString(settings["driver_app_update_message"]) ?? DEFAULT_FORCE_MESSAGE;
    const force = forceUpdateFromDriver(rider.driver, code, message);
    if (force.clear) {
      await db.collection(COLLECTIONS.drivers).doc(rider.uid).set(
        {
          force_app_update_at: null,
          force_app_update_min_code: null,
          force_app_update_by: null,
        },
        { merge: true },
      );
    }

    return { updated, force_update: force.payload };
  } catch {
    return { updated: false };
  }
});

export type LoginKeyVerdict = "ok" | "object_key_required" | "invalid_object_key";

export function classifyLoginVerificationKey(driverId: string, objectKey: string | null): LoginKeyVerdict {
  if (objectKey == null || objectKey === "") return "object_key_required";
  if (objectKey.includes("..")) return "invalid_object_key";
  const prefix = `drivers/${driverId}/login_verification/`;
  return objectKey.startsWith(prefix) ? "ok" : "invalid_object_key";
}

export const driverRecordLoginVerification = onCall(async (request) => {
  const rider = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const key = pickText(data, "p_object_key", "object_key", "objectKey");
  const verdict = classifyLoginVerificationKey(rider.uid, key);
  if (verdict !== "ok") throw riderError("invalid-argument", verdict);

  const passed = pickBoolean(data, "p_liveness_passed", "liveness_passed");
  const method = pickText(data, "p_liveness_method", "liveness_method");
  const now = Timestamp.now();
  const id = crypto.randomUUID();
  await getFirestore().collection(LOGIN_VERIFICATIONS).doc(id).set({
    driver_id: rider.uid,
    object_key: key,
    captured_at: now,
    created_at: now,
    liveness_passed: passed,
    liveness_method: method,
  });

  await logDriverOperation({
    driverId: rider.uid,
    module: "auth",
    action: "auth.login_selfie",
    actor: "driver_record_login_verification",
    success: true,
    recordType: "login_verification",
    recordId: id,
    detail: { liveness_passed: passed, liveness_method: method },
  });

  const capturedAt = isoTimestamp(now);
  return {
    ok: true,
    id,
    object_key: key,
    captured_at: capturedAt,
    created_at: capturedAt,
    liveness_passed: passed,
    liveness_method: method,
  };
});
