import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "../core/collections";
import { requireStaff } from "../core/staff";
import { isoTimestamp, loadDocMap, pickCount, pickId, pickIdList, pickObject, pickText, pickTriBool, type Dict } from "./_shared";

const APP_SETTINGS_DOC_ID = "1";
/** `p_days` is clamped the same way the SQL clamped it: 1..90, default 7. */
const MULTI_DEVICE_MAX_DAYS = 90;
const HISTORY_LIMIT_MAX = 100;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asTimestampMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/** One `driver_device_sessions` document in the wire shape `admin_driver_device_overview` returned. */
function sessionJson(raw: Dict, activeDeviceId: string | null, docId: string): Dict {
  const deviceId = asString(raw["device_id"]);
  return {
    session_id: docId,
    device_id: deviceId,
    device_model: asString(raw["device_model"]),
    device_manufacturer: asString(raw["device_manufacturer"]),
    os_version: asString(raw["os_version"]),
    android_sdk_int: asNumber(raw["android_sdk_int"]),
    app_version_name: asString(raw["app_version_name"]),
    app_version_code: asNumber(raw["app_version_code"]),
    first_seen_at: isoTimestamp(raw["first_seen_at"]),
    last_seen_at: isoTimestamp(raw["last_seen_at"]),
    revoked_at: isoTimestamp(raw["revoked_at"]),
    revoked_reason: asString(raw["revoked_reason"]),
    flush_deadline_at: isoTimestamp(raw["flush_deadline_at"]),
    flushed_at: isoTimestamp(raw["flushed_at"]),
    is_active: deviceId !== null && deviceId === activeDeviceId,
  };
}

/**
 * `admin_list_driver_devices`.
 *
 * One row per non-archived driver, joined to its active device session. The SQL
 * did this with a LEFT JOIN on `d.active_device_id = s.device_id AND s.revoked_at IS NULL`;
 * Firestore has no join, so the sessions of the active devices are read once into
 * a map. The roster is the driver set, and archived riders were excluded there
 * and are excluded here for the same reason: an archived row is not a device.
 */
export const adminListDriverDevices = onCall(async (request) => {
  await requireStaff(request, "driver_devices.view");

  const db = getFirestore();
  const [settingsSnap, driverSnap] = await Promise.all([
    db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get(),
    db.collection(COLLECTIONS.drivers).where("archived_at", "==", null).get(),
  ]);

  const settings = (settingsSnap.data() ?? {}) as Dict;
  const driverIds = driverSnap.docs.map((doc) => doc.id);
  const [profileById, zoneById] = await Promise.all([
    loadDocMap(COLLECTIONS.profiles, driverIds),
    loadDocMap(
      COLLECTIONS.zones,
      driverSnap.docs
        .map((doc) => asString(doc.get("zone_id")))
        .filter((id): id is string => id !== null),
    ),
  ]);

  const activeDeviceIds = driverSnap.docs
    .map((doc) => asString(doc.get("active_device_id")))
    .filter((id): id is string => id !== null);
  const sessionByDriverDevice = new Map<string, Dict>();
  if (activeDeviceIds.length > 0) {
    for (let index = 0; index < activeDeviceIds.length; index += 30) {
      const group = activeDeviceIds.slice(index, index + 30);
      // Equality on `device_id` only: adding `revoked_at` would need a composite
      // index, and the revocation check is cheap on the handful of rows a device
      // id can match.
      const snap = await db
        .collection(COLLECTIONS.driverDeviceSessions)
        .where("device_id", "in", group)
        .get();
      for (const doc of snap.docs) {
        const raw = doc.data() as Dict;
        if (raw["revoked_at"] != null) continue;
        const driverId = asString(raw["driver_id"]);
        const deviceId = asString(raw["device_id"]);
        if (driverId && deviceId) sessionByDriverDevice.set(`${driverId}\u0000${deviceId}`, raw);
      }
    }
  }

  const rows = driverSnap.docs
    .map((doc) => {
      const driver = doc.data() as Dict;
      const profile = profileById.get(doc.id);
      const zoneId = asString(driver["zone_id"]);
      const activeDeviceId = asString(driver["active_device_id"]);
      const session = activeDeviceId
        ? sessionByDriverDevice.get(`${doc.id}\u0000${activeDeviceId}`)
        : undefined;
      return {
        driver_id: doc.id,
        driver_code: asString(driver["driver_code"]),
        employee_id: asString(driver["employee_id"]),
        full_name: profile ? asString(profile["full_name"]) : null,
        phone: profile ? asString(profile["phone"]) : null,
        status: asString(driver["status"]),
        is_on_duty: Boolean(driver["is_on_duty"]),
        is_blocked: Boolean(driver["is_blocked"]),
        avatar_object_key: asString(driver["avatar_object_key"]),
        zone_id: zoneId,
        zone_name: zoneId ? asString(zoneById.get(zoneId)?.["name"]) : null,
        active_device_id: activeDeviceId,
        session_id: session ? session["id"] ?? null : null,
        device_model: session ? asString(session["device_model"]) : null,
        device_manufacturer: session ? asString(session["device_manufacturer"]) : null,
        os_version: session ? asString(session["os_version"]) : null,
        android_sdk_int: session ? asNumber(session["android_sdk_int"]) : null,
        app_version_name: session ? asString(session["app_version_name"]) : null,
        app_version_code: session ? asNumber(session["app_version_code"]) : null,
        device_meta: session ? (session["device_meta"] ?? null) : null,
        device_meta_at: session ? isoTimestamp(session["device_meta_at"]) : null,
        last_seen_at: session ? isoTimestamp(session["last_seen_at"]) : null,
        first_seen_at: session ? isoTimestamp(session["first_seen_at"]) : null,
        force_app_update_at: isoTimestamp(driver["force_app_update_at"]),
        force_app_update_min_code: asNumber(driver["force_app_update_min_code"]),
      };
    })
    // `ORDER BY t.driver_code`; a null code sorts last rather than first.
    .sort((a, b) => (a.driver_code ?? "\uffff").localeCompare(b.driver_code ?? "\uffff"));

  return {
    min_version_code: asNumber(settings["driver_app_min_version_code"]),
    min_version_name: asString(settings["driver_app_min_version_name"]),
    rows,
  };
});

/**
 * `admin_driver_device_overview`.
 *
 * The active session plus the N most recent sessions for one driver. The SQL
 * built the active row from `drivers.active_device_session_id` and aggregated the
 * history separately so a driver with many sessions does not drop the active one
 * out of a fixed-size page.
 */
export const adminDriverDeviceOverview = onCall(async (request) => {
  await requireStaff(request, "driver_devices.view");

  const data = (request.data ?? {}) as Dict;
  const driverId = pickId(data, "driverId", "p_driver_id");
  if (!driverId) throw new HttpsError("invalid-argument", "driver_id_required");

  const limit = Math.min(Math.max(pickCount(data, 20, "historyLimit", "p_history_limit"), 1), HISTORY_LIMIT_MAX);

  const db = getFirestore();
  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  const driver = (driverSnap.data() ?? {}) as Dict;
  const activeDeviceId = asString(driver["active_device_id"]);
  const activeSessionId = asString(driver["active_device_session_id"]);

  const historySnap = await db
    .collection(COLLECTIONS.driverDeviceSessions)
    .where("driver_id", "==", driverId)
    .get();

  const activeSnap = activeSessionId
    ? await db.collection(COLLECTIONS.driverDeviceSessions).doc(activeSessionId).get()
    : null;

  const activeDevice = activeSnap?.exists
    ? sessionJson((activeSnap.data() ?? {}) as Dict, activeDeviceId, activeSnap.id)
    : null;

  return {
    driver_id: driverId,
    active_device_id: activeDeviceId,
    active_device: activeDevice,
    // `ORDER BY last_seen_at DESC` is applied here rather than in a query: an
    // equality plus an order-by on a different field is a composite index, and a
    // rider's device history is short enough that sorting it is free.
    history: historySnap.docs
      .map((doc) => ({ doc, raw: doc.data() as Dict }))
      .sort((a, b) => {
        const left = asTimestampMillis(a.raw["last_seen_at"]);
        const right = asTimestampMillis(b.raw["last_seen_at"]);
        return right - left;
      })
      .slice(0, limit)
      .map(({ doc, raw }) => sessionJson(raw, activeDeviceId, doc.id)),
  };
});

/**
 * `admin_drivers_multi_device_recent`.
 *
 * Drivers seen on more than one distinct device inside the window. A driver
 * account shared across several handsets is the signature this filter exists to
 * surface, so the grouping is by driver and the count is DISTINCT devices.
 */
export const adminDriversMultiDeviceRecent = onCall(async (request) => {
  await requireStaff(request, "driver_devices.view");

  const data = (request.data ?? {}) as Dict;
  const days = Math.min(Math.max(pickCount(data, 7, "days", "p_days"), 1), MULTI_DEVICE_MAX_DAYS);
  const cutoff = Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60 * 1000);

  const db = getFirestore();
  const snap = await db
    .collection(COLLECTIONS.driverDeviceSessions)
    .where("last_seen_at", ">=", cutoff)
    .get();

  const byDriver = new Map<string, { devices: Set<string>; latest: Timestamp | null }>();
  for (const doc of snap.docs) {
    const raw = doc.data() as Dict;
    const driverId = asString(raw["driver_id"]);
    const deviceId = asString(raw["device_id"]);
    if (!driverId || !deviceId) continue;
    const lastSeen = raw["last_seen_at"];
    const at = lastSeen instanceof Timestamp ? lastSeen : null;
    const entry = byDriver.get(driverId) ?? { devices: new Set<string>(), latest: null };
    entry.devices.add(deviceId);
    if (at && (!entry.latest || at.toMillis() > entry.latest.toMillis())) entry.latest = at;
    byDriver.set(driverId, entry);
  }

  return [...byDriver.entries()]
    .filter(([, entry]) => entry.devices.size > 1)
    .map(([driverId, entry]) => ({
      driver_id: driverId,
      device_count: entry.devices.size,
      latest_activity_at: entry.latest ? entry.latest.toDate().toISOString() : null,
    }))
    .sort((a, b) => {
      const left = a.latest_activity_at ? Date.parse(a.latest_activity_at) : 0;
      const right = b.latest_activity_at ? Date.parse(b.latest_activity_at) : 0;
      return right - left;
    });
});

/**
 * `admin_force_sign_out_driver`.
 *
 * Revokes the active session and clears the active-device pointers. The device id
 * is read from the driver row first, because the revocation should name the
 * session that is actually active rather than sweep every session the driver ever
 * opened.
 */
export const adminForceSignOutDriver = onCall(async (request) => {
  await requireStaff(request, "driver_devices.view");

  const data = (request.data ?? {}) as Dict;
  const driverId = pickId(data, "driverId", "p_driver_id");
  if (!driverId) throw new HttpsError("invalid-argument", "driver_id_required");

  const db = getFirestore();
  const driverRef = db.collection(COLLECTIONS.drivers).doc(driverId);
  const driverSnap = await driverRef.get();
  const activeDeviceId = asString((driverSnap.data() ?? {})["active_device_id"]);

  const now = Timestamp.now();
  if (activeDeviceId) {
    const sessions = await db
      .collection(COLLECTIONS.driverDeviceSessions)
      .where("driver_id", "==", driverId)
      .where("device_id", "==", activeDeviceId)
      .where("revoked_at", "==", null)
      .get();
    const batch = db.batch();
    for (const doc of sessions.docs) {
      batch.update(doc.ref, { revoked_at: now, revoked_reason: "admin_forced", updated_at: now });
    }
    if (!sessions.empty) await batch.commit();
  }

  await driverRef.set(
    { active_device_id: null, active_device_session_id: null, updated_at: now },
    { merge: true },
  );

  return { ok: true };
});

/**
 * `admin_set_driver_force_update`.
 *
 * Setting a floor stamps the actor; clearing it only touches rows that actually
 * had one, so the returned count is "how many drivers this changed" and not "how
 * many ids were sent".
 */
export const adminSetDriverForceUpdate = onCall(async (request) => {
  const staff = await requireStaff(request, "driver_devices.view");

  const data = (request.data ?? {}) as Dict;
  const driverIds = pickIdList(data, "driverIds", "p_driver_ids") ?? [];
  if (driverIds.length === 0) return { updated: 0, enabled: false };

  const enabled = pickTriBool(data, "enabled", "p_enabled") ?? false;
  const minCode = pickCount(data, 0, "minCode", "p_min_code");

  if (enabled && minCode < 1) {
    throw new HttpsError("invalid-argument", "invalid_min_code");
  }

  const db = getFirestore();
  const now = Timestamp.now();
  let updated = 0;
  for (let index = 0; index < driverIds.length; index += 400) {
    const group = driverIds.slice(index, index + 400);
    const snaps = await db.getAll(...group.map((id) => db.collection(COLLECTIONS.drivers).doc(id)));
    const batch = db.batch();
    let touched = 0;
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const driver = (snap.data() ?? {}) as Dict;
      if (driver["archived_at"] != null) continue;
      if (enabled) {
        batch.update(snap.ref, {
          force_app_update_at: now,
          force_app_update_min_code: minCode,
          force_app_update_by: staff.uid,
        });
        touched += 1;
      } else if (driver["force_app_update_at"] != null) {
        batch.update(snap.ref, {
          force_app_update_at: null,
          force_app_update_min_code: null,
          force_app_update_by: null,
        });
        touched += 1;
      }
    }
    if (touched > 0) {
      await batch.commit();
      updated += touched;
    }
  }

  return { updated, enabled };
});

/** `driver_record_app_version` — the app's own build report, not an admin read. */
export const driverRecordAppVersion = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "not_authenticated");

  const data = (request.data ?? {}) as Dict;
  const versionCode = pickCount(data, 0, "versionCode", "p_version_code");
  const versionName = pickText(data, "versionName", "p_version_name");
  const deviceId = pickId(data, "deviceId", "p_device_id");
  const meta = pickObject(data, "deviceMeta", "p_device_meta");

  const db = getFirestore();
  const driverRef = db.collection(COLLECTIONS.drivers).doc(request.auth.uid);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) throw new HttpsError("failed-precondition", "driver_not_found");

  const patch: Dict = { app_version_code: versionCode || null, app_version_name: versionName };
  if (meta || deviceId) patch["device_meta"] = meta;
  if (meta) patch["device_meta_at"] = Timestamp.now();

  // A build at or above the per-driver floor clears the demand, which is what
  // stops the Update Required screen from reappearing after the rider updated.
  const minCode = asNumber((driverSnap.data() ?? {})["force_app_update_min_code"]);
  if (minCode !== null && versionCode >= minCode) {
    patch["force_app_update_at"] = null;
    patch["force_app_update_min_code"] = null;
    patch["force_app_update_by"] = null;
  }

  await driverRef.set(patch, { merge: true });
  return { ok: true };
});
