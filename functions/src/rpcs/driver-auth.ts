import { getAuth } from "firebase-admin/auth";
import { onCall } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "../core/fs";
import { COLLECTIONS, UNIQUE_LOCKS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireRider, riderError } from "../core/rider";
import { isoTimestamp, logDriverOperation, pickBoolean, pickText, type Dict } from "./_shared";

const FLUSH_GRACE_MS = 5 * 60 * 1000;
export const FIRST_GATED_VERSION_CODE = 83;

export const DEFAULT_UPDATE_MESSAGE =
  "A new version of the app is required. Please update from Google Play to continue.\n" +
  "يلزم تحديث التطبيق من Google Play للمتابعة.";

const DEVICE_META_KEYS = new Set([
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
]);

export type DeviceMeta = {
  model?: string | null;
  manufacturer?: string | null;
  os_version?: string | null;
  android_sdk_int?: number | null;
  app_version_name?: string | null;
  app_version_code?: number | null;
  raw?: Record<string, unknown>;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asDay(value: unknown): string | null {
  const text = asString(value);
  return text ? text.slice(0, 10) : null;
}

export function sanitizeDeviceMetaBlob(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (!DEVICE_META_KEYS.has(key) || value == null) continue;
    if (key === "supported_abis") {
      if (!Array.isArray(value)) continue;
      const items = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 32))
        .filter(Boolean)
        .slice(0, 8);
      if (items.length) out[key] = items;
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      const text = value.trim().slice(0, 120);
      if (text && text.toLowerCase() !== "unknown" && text.toLowerCase() !== "null") {
        out[key] = text;
      }
    }
  }
  return out;
}

export function parseDeviceMeta(raw: unknown): DeviceMeta {
  if (!raw || typeof raw !== "object") return {};
  const meta = raw as Record<string, unknown>;
  const sdk = asFiniteNumber(meta["android_sdk_int"]);
  const versionCode = asFiniteNumber(meta["app_version_code"]);
  return {
    model: typeof meta["model"] === "string" ? meta["model"] : null,
    manufacturer: typeof meta["manufacturer"] === "string" ? meta["manufacturer"] : null,
    os_version: typeof meta["os_version"] === "string" ? meta["os_version"] : null,
    android_sdk_int: sdk != null ? Math.trunc(sdk) : null,
    app_version_name: typeof meta["app_version_name"] === "string" ? meta["app_version_name"] : null,
    app_version_code: versionCode != null ? Math.trunc(versionCode) : null,
    raw: sanitizeDeviceMetaBlob(meta),
  };
}

export function updateRequiredKind(reported: number | null | undefined): "driver_blocked" | "update_required" {
  if (reported == null || !Number.isFinite(reported) || reported < FIRST_GATED_VERSION_CODE) {
    return "driver_blocked";
  }
  return "update_required";
}

function refuseUpdateRequired(opts: {
  reported: number | null | undefined;
  minCode: number;
  minName: string | null;
  message: string;
}): never {
  const kind = updateRequiredKind(opts.reported);
  if (kind === "driver_blocked") {
    throw riderError("failed-precondition", "driver_blocked", {
      reason: opts.message,
      message: opts.message,
      update_required: true,
      min_version_code: opts.minCode,
      min_version_name: opts.minName,
    });
  }
  throw riderError("failed-precondition", "update_required", {
    min_version_code: opts.minCode,
    min_version_name: opts.minName,
    message: opts.message,
  });
}

function freezeIsActive(from: unknown, until: unknown, today: string): boolean {
  const start = asDay(from);
  const end = asDay(until);
  return start !== null && end !== null && today >= start && today <= end;
}

function loginMatches(driver: Dict, loginId: string): boolean {
  const employeeId = asString(driver["employee_id"]);
  const driverCode = asString(driver["driver_code"]);
  return (
    (employeeId !== null && employeeId.toLowerCase() === loginId.toLowerCase()) ||
    driverCode === loginId
  );
}

async function loadDriverDoc(id: string): Promise<{ id: string; data: Dict } | null> {
  const snap = await getFirestore().collection(COLLECTIONS.drivers).doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, data: (snap.data() ?? {}) as Dict };
}

async function lookupDriver(loginId: string, passcode: string): Promise<{ id: string; data: Dict } | null> {
  const db = getFirestore();
  const [byEmployee, byCode] = await Promise.all([
    db.collection(COLLECTIONS.drivers).where("employee_id", "==", loginId).limit(1).get(),
    db.collection(COLLECTIONS.drivers).where("driver_code", "==", loginId).limit(1).get(),
  ]);
  const first = !byEmployee.empty
    ? { id: byEmployee.docs[0].id, data: (byEmployee.docs[0].data() ?? {}) as Dict }
    : !byCode.empty
      ? { id: byCode.docs[0].id, data: (byCode.docs[0].data() ?? {}) as Dict }
      : null;
  if (first && first.data["app_passcode"] === passcode && loginMatches(first.data, loginId)) {
    return first;
  }

  const lockSnap = await db.collection(UNIQUE_LOCKS.passcode).doc(passcode).get();
  if (lockSnap.exists) {
    const lock = (lockSnap.data() ?? {}) as Dict;
    const ownerId = asString(lock["owner_id"]) ?? asString(lock["driver_id"]);
    if (ownerId) {
      const owned = await loadDriverDoc(ownerId);
      if (
        owned &&
        owned.data["app_passcode"] === passcode &&
        loginMatches(owned.data, loginId)
      ) {
        return owned;
      }
    }
  }

  const employeeLockIds = [encodeURIComponent(loginId), encodeURIComponent(loginId.toLowerCase())];
  for (const lockId of employeeLockIds) {
    const employeeLock = await db.collection(UNIQUE_LOCKS.employeeId).doc(lockId).get();
    if (!employeeLock.exists) continue;
    const lock = (employeeLock.data() ?? {}) as Dict;
    const ownerId = asString(lock["owner_id"]) ?? asString(lock["driver_id"]);
    if (!ownerId) continue;
    const owned = await loadDriverDoc(ownerId);
    if (
      owned &&
      owned.data["app_passcode"] === passcode &&
      loginMatches(owned.data, loginId)
    ) {
      return owned;
    }
  }

  return null;
}

function assertLoginAllowed(driver: Dict, today: string): void {
  if (driver["archived_at"] != null) {
    throw riderError("unauthenticated", "driver_archived");
  }
  const status = asString(driver["status"]);
  if (driver["is_blocked"] === true) {
    throw riderError("failed-precondition", "driver_blocked", {
      reason: asString(driver["blocked_reason"]),
    });
  }
  if (freezeIsActive(driver["frozen_from"], driver["frozen_until"], today)) {
    const until = asDay(driver["frozen_until"]);
    const reason =
      (asString(driver["freeze_reason"]) ?? "Account frozen") + (until ? ` (until ${until})` : "");
    throw riderError("failed-precondition", "driver_blocked", { reason, freeze: true });
  }
  if (status === "suspended") {
    throw riderError("unauthenticated", "driver_suspended");
  }
  if (status !== "active") {
    throw riderError("unauthenticated", "driver_not_active");
  }
}

async function loadAppSettingsRow(): Promise<Dict> {
  const snap = await getFirestore().collection(COLLECTIONS.appSettings).doc("1").get();
  return (snap.data() ?? {}) as Dict;
}

async function sessionOnDevice(
  driverId: string,
  deviceId: string,
): Promise<{ id: string; data: Dict } | null> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverDeviceSessions)
    .where("driver_id", "==", driverId)
    .where("device_id", "==", deviceId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: (snap.docs[0].data() ?? {}) as Dict };
}

async function mintRiderToken(uid: string, deviceId: string): Promise<string> {
  const auth = getAuth();
  try {
    await auth.getUser(uid);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
    if (code !== "auth/user-not-found") {
      throw riderError("internal", "server_error");
    }
    await auth.createUser({ uid });
  }
  await auth.setCustomUserClaims(uid, { rider: true, deviceId });
  return auth.createCustomToken(uid, { rider: true, deviceId });
}

export const driverPasscodeLogin = onCall(async (request) => {
  const data = (request.data ?? {}) as Dict;
  const loginId = (pickText(data, "employee_id", "driver_code") ?? "").trim();
  const passcode = (pickText(data, "passcode") ?? "").trim();
  const deviceId = (pickText(data, "device_id") ?? "").trim();
  const forceOverride = pickBoolean(data, "force_override");
  const deviceMeta = parseDeviceMeta(data["device_meta"]);

  if (!loginId || !passcode) {
    throw riderError("unauthenticated", "invalid_credentials");
  }
  if (!deviceId) {
    throw riderError("invalid-argument", "device_id_required");
  }

  const settings = await loadAppSettingsRow();
  if (settings["driver_app_force_update"] === true) {
    const minCode = asFiniteNumber(settings["driver_app_min_version_code"]);
    if (minCode !== null) {
      const reported = deviceMeta.app_version_code ?? null;
      const below = reported == null || !Number.isFinite(reported) || reported < minCode;
      if (below) {
        const configured = asString(settings["driver_app_update_message"]);
        refuseUpdateRequired({
          reported,
          minCode,
          minName: asString(settings["driver_app_min_version_name"]),
          message: configured ?? DEFAULT_UPDATE_MESSAGE,
        });
      }
    }
  }

  const found = await lookupDriver(loginId, passcode);
  if (!found) {
    throw riderError("unauthenticated", "invalid_credentials");
  }

  const today = kuwaitDayString(new Date());
  assertLoginAllowed(found.data, today);

  const perDriverMin = asFiniteNumber(found.data["force_app_update_min_code"]);
  if (found.data["force_app_update_at"] != null && perDriverMin !== null) {
    const reported = deviceMeta.app_version_code ?? null;
    const below = reported == null || !Number.isFinite(reported) || reported < perDriverMin;
    if (below) {
      const configured = asString(settings["driver_app_update_message"]);
      refuseUpdateRequired({
        reported,
        minCode: perDriverMin,
        minName: asString(settings["driver_app_min_version_name"]),
        message: configured ?? DEFAULT_UPDATE_MESSAGE,
      });
    }
    await getFirestore().collection(COLLECTIONS.drivers).doc(found.id).set(
      {
        force_app_update_at: null,
        force_app_update_min_code: null,
        force_app_update_by: null,
      },
      { merge: true },
    );
  }

  const activeDeviceId = asString(found.data["active_device_id"]);
  if (activeDeviceId && activeDeviceId !== deviceId && !forceOverride) {
    const active = await sessionOnDevice(found.id, activeDeviceId);
    throw riderError("already-exists", "device_conflict", {
      active_device: {
        device_id: activeDeviceId,
        device_model: active?.data["device_model"] ?? null,
        device_manufacturer: active?.data["device_manufacturer"] ?? null,
        last_seen_at: isoTimestamp(active?.data["last_seen_at"]),
      },
    });
  }

  const now = new Date();
  const stamp = Timestamp.fromDate(now);
  const flushDeadline = Timestamp.fromDate(new Date(now.getTime() + FLUSH_GRACE_MS));
  const db = getFirestore();

  if (activeDeviceId && activeDeviceId !== deviceId && forceOverride) {
    const previous = await db
      .collection(COLLECTIONS.driverDeviceSessions)
      .where("driver_id", "==", found.id)
      .where("device_id", "==", activeDeviceId)
      .limit(20)
      .get();
    const batch = db.batch();
    for (const doc of previous.docs) {
      if (doc.get("revoked_at") != null) continue;
      batch.set(
        doc.ref,
        {
          revoked_at: stamp,
          revoked_reason: "override",
          flush_deadline_at: flushDeadline,
          updated_at: stamp,
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  const existing = await sessionOnDevice(found.id, deviceId);
  const rawMeta = deviceMeta.raw && Object.keys(deviceMeta.raw).length > 0 ? deviceMeta.raw : null;
  const sessionPayload: Dict = {
    driver_id: found.id,
    device_id: deviceId,
    device_model: deviceMeta.model ?? null,
    device_manufacturer: deviceMeta.manufacturer ?? null,
    os_version: deviceMeta.os_version ?? null,
    android_sdk_int: deviceMeta.android_sdk_int ?? null,
    app_version_name: deviceMeta.app_version_name ?? null,
    app_version_code: deviceMeta.app_version_code ?? null,
    device_meta: rawMeta,
    device_meta_at: rawMeta ? stamp : null,
    first_seen_at: existing?.data["first_seen_at"] ?? stamp,
    last_seen_at: stamp,
    revoked_at: null,
    revoked_reason: null,
    flush_deadline_at: null,
    flushed_at: null,
    updated_at: stamp,
  };

  const sessionRef = existing
    ? db.collection(COLLECTIONS.driverDeviceSessions).doc(existing.id)
    : db.collection(COLLECTIONS.driverDeviceSessions).doc();
  try {
    await sessionRef.set(sessionPayload, { merge: true });
    await db.collection(COLLECTIONS.drivers).doc(found.id).set(
      {
        active_device_id: deviceId,
        active_device_session_id: sessionRef.id,
        updated_at: stamp,
      },
      { merge: true },
    );
  } catch {
    throw riderError("internal", "server_error");
  }

  let customToken: string;
  try {
    customToken = await mintRiderToken(found.id, deviceId);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      throw riderError("internal", "server_error");
    }
    throw error;
  }

  await logDriverOperation({
    driverId: found.id,
    module: "auth",
    action: "auth.passcode_lookup",
    actor: "rpc",
    success: true,
    recordType: "driver",
    recordId: found.id,
    detail: { device_id: deviceId, force_override: forceOverride },
  });

  return {
    custom_token: customToken,
    user_id: found.id,
    driver_code: asString(found.data["driver_code"]) ?? loginId,
    device_id: deviceId,
  };
});

export const driverHeartbeat = onCall(async (request) => {
  const { uid, driver } = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const deviceId = (pickText(data, "device_id", "p_device_id") ?? "").trim();
  if (!deviceId) {
    throw riderError("invalid-argument", "device_id_required");
  }

  const now = Timestamp.now();
  const session = await sessionOnDevice(uid, deviceId);
  if (session) {
    await getFirestore().collection(COLLECTIONS.driverDeviceSessions).doc(session.id).set(
      { last_seen_at: now, updated_at: now },
      { merge: true },
    );
  }

  const activeDeviceId = asString(driver["active_device_id"]);
  if (activeDeviceId === deviceId) {
    return {
      ok: true,
      kicked: false,
      flush_grace_active: false,
      flush_deadline_at: null,
      active_device: null,
    };
  }

  const deadline = session ? isoTimestamp(session.data["flush_deadline_at"]) : null;
  await logDriverOperation({
    driverId: uid,
    module: "device",
    action: "device.heartbeat_rejected",
    actor: "rpc",
    success: true,
    recordType: "device",
    detail: { device_id: deviceId, active_device_id: activeDeviceId, flush_deadline_at: deadline },
  });

  return {
    ok: true,
    kicked: true,
    flush_grace_active:
      session?.data["revoked_reason"] === "override" &&
      session.data["flushed_at"] == null &&
      session.data["flush_deadline_at"] != null,
    flush_deadline_at: deadline,
  };
});

export const driverReleaseDeviceSession = onCall(async (request) => {
  const { uid, driver } = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const deviceId = (pickText(data, "device_id", "p_device_id") ?? "").trim();
  if (!deviceId) return { ok: true };

  const db = getFirestore();
  const now = Timestamp.now();
  const session = await sessionOnDevice(uid, deviceId);
  if (session && session.data["revoked_at"] == null) {
    await db.collection(COLLECTIONS.driverDeviceSessions).doc(session.id).set(
      {
        revoked_at: now,
        revoked_reason: session.data["revoked_reason"] ?? "manual_signout",
        updated_at: now,
      },
      { merge: true },
    );
  }

  const active = asString(driver["active_device_id"]);
  if (active === deviceId) {
    await db.collection(COLLECTIONS.drivers).doc(uid).set(
      {
        active_device_id: null,
        active_device_session_id: null,
        updated_at: now,
      },
      { merge: true },
    );
  }

  await logDriverOperation({
    driverId: uid,
    module: "device",
    action: "device.signout",
    actor: "rpc",
    success: true,
    recordType: "device",
    detail: { device_id: deviceId, cleared_active: active === deviceId },
  });

  return { ok: true };
});
