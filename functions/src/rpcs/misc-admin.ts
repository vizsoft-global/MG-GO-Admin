import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldPath,
  FieldValue,
  Timestamp,
  type QueryDocumentSnapshot,
} from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireStaff, requireStaffFresh, requireStaffAny } from "../core/staff";
import { kuwaitDayString } from "../core/kuwait";
import { applyDeliveryRollup } from "../core/rollups";
import { stampStoredRow } from "../core/search-text";
import { notifyDriverTransactional as writeTransactionalNotification } from "./visits-shared";
import { invalidateDriverHomeDailySafe } from "./driver-home";
import { inboxListMillis, inboxMatchesBefore, mapInboxListItem } from "./driver-push-tokens";
import type { Dict } from "./_shared";

/**
 * Firestore caps a batched write at 500 operations and an `in` filter at 30.
 * 200 is the batch size because marking read writes two documents per row
 * (the item plus its `notification_events` row) and 2 x 200 + 1 = 401.
 */
const BATCH_LIMIT = 200;
const IN_FILTER_LIMIT = 30;
const INBOX_LIMIT = 100;
const SCAN_CAP = 1000;

function pick(data: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    const value = data[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function pickId(data: Record<string, unknown>, ...names: string[]): string | null {
  const value = pick(data, ...names);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function pickIdList(data: Record<string, unknown>, ...names: string[]): string[] | null {
  const value = pick(data, ...names);
  if (value === null || value === undefined) return null;
  const raw = Array.isArray(value) ? value : null;
  if (!raw) return null;
  const out = raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return out;
}

function pickCount(data: Record<string, unknown>, fallback: number, ...names: string[]): number {
  const value = pick(data, ...names);
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
}

function pickBoolean(data: Record<string, unknown>, ...names: string[]): boolean {
  for (const name of names) {
    const value = data[name];
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return false;
}

function pickInstant(data: Record<string, unknown>, ...names: string[]): Date | null {
  const value = pick(data, ...names);
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** Every rider-facing callable here answers to `driver_id` = the caller. */
function requireDriverId(request: { auth?: { uid?: string } | null }): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "not_authenticated");
  return uid;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * `driver_list_notifications` — the rider inbox.
 *
 * Dismissed rows are gone from the list but stay in `notification_dispatch_items`
 * because the admin engagement report reads `opened_at` / `clicked_at` off the
 * same documents; deleting them would erase the campaign's own analytics.
 */
export const driverListNotifications = onCall(async (request) => {
  const driverId = requireDriverId(request);
  const data = (request.data ?? {}) as Record<string, unknown>;

  const limit = Math.min(Math.max(pickCount(data, 50, "limit", "p_limit"), 1), INBOX_LIMIT);
  const before = pickInstant(data, "before", "p_before");
  const unreadOnly = pickBoolean(data, "unreadOnly", "p_unread_only");

  const db = getFirestore();
  // orderBy(created_at) drops documents that never received the field. The
  // unread count does not order, so the badge can be 1 while the list is empty.
  const snapshot = await db
    .collection(COLLECTIONS.notificationDispatchItems)
    .where("driver_id", "==", driverId)
    .where("dismissed_at", "==", null)
    .limit(SCAN_CAP)
    .get();

  let rows = snapshot.docs.map((doc) => ({
    id: doc.id,
    data: (doc.data() ?? {}) as Dict,
  }));
  if (before) rows = rows.filter((row) => inboxMatchesBefore(row.data, before.toISOString()));
  if (unreadOnly) rows = rows.filter((row) => !row.data["opened_at"]);
  rows.sort((a, b) => inboxListMillis(b.data) - inboxListMillis(a.data));
  rows = rows.slice(0, limit);

  const campaignRefs = rows.map((row) =>
    db.collection(COLLECTIONS.notificationCampaigns).doc(String(row.data["campaign_id"] ?? "")),
  );
  const campaigns = campaignRefs.length ? await db.getAll(...campaignRefs) : [];
  const campaignById = new Map(campaigns.map((snap) => [snap.id, snap.data() ?? {}]));

  const unreadSnap = await db
    .collection(COLLECTIONS.notificationDispatchItems)
    .where("driver_id", "==", driverId)
    .where("dismissed_at", "==", null)
    .where("opened_at", "==", null)
    .count()
    .get();

  const items = rows.map((row) => {
    const campaign = campaignById.get(String(row.data["campaign_id"] ?? "")) ?? {};
    return {
      dispatch_item_id: row.id,
      ...mapInboxListItem(row.data, campaign),
    };
  });

  return { items, unread_count: unreadSnap.data().count };
});

/**
 * `driver_mark_notifications_read`.
 *
 * Only rows that were unread are touched, so the returned count is the number the
 * rider actually cleared rather than the number they asked about — which is what
 * the app uses to decide whether to re-render the badge.
 */
export const driverMarkNotificationsRead = onCall(async (request) => {
  const driverId = requireDriverId(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const ids = pickIdList(data, "dispatchItemIds", "p_dispatch_item_ids");

  const db = getFirestore();

  let candidates: QueryDocumentSnapshot[] = [];
  if (ids && ids.length > 0) {
    for (const group of chunk(ids, IN_FILTER_LIMIT)) {
      const snap = await db
        .collection(COLLECTIONS.notificationDispatchItems)
        .where("driver_id", "==", driverId)
        .where("opened_at", "==", null)
        .where(FieldPath.documentId(), "in", group.map((id) => `${COLLECTIONS.notificationDispatchItems}/${id}`))
        .get();
      candidates.push(...snap.docs);
    }
  } else {
    const snap = await db
      .collection(COLLECTIONS.notificationDispatchItems)
      .where("driver_id", "==", driverId)
      .where("opened_at", "==", null)
      .limit(SCAN_CAP)
      .get();
    candidates = snap.docs;
  }

  if (candidates.length === 0) return 0;

  for (const group of chunk(candidates, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const doc of group) {
      batch.update(doc.ref, {
        opened_at: FieldValue.serverTimestamp(),
        status: "opened",
        updated_at: FieldValue.serverTimestamp(),
      });
      batch.set(db.collection(COLLECTIONS.notificationEvents).doc(), {
        campaign_id: doc.get("campaign_id") ?? null,
        dispatch_item_id: doc.id,
        driver_id: driverId,
        event_type: "opened",
        provider: "fcm",
        occurred_at: FieldValue.serverTimestamp(),
        metadata: { source: "inbox" },
      });
      batch.set(db.collection(COLLECTIONS.driverOperationEvents).doc(), {
        driver_id: driverId,
        module: "notification",
        action: "notification.read",
        source: "rpc",
        actor: "driver_mark_notifications_read",
        success: true,
        record_type: "notification",
        record_id: null,
        detail: {
          count: group.length,
          scope: ids && ids.length > 0 ? "selected" : "all",
        },
        occurred_at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  return candidates.length;
});

/** `driver_dismiss_notifications` — soft-clear, never a delete. */
export const driverDismissNotifications = onCall(async (request) => {
  const driverId = requireDriverId(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const ids = pickIdList(data, "dispatchItemIds", "p_dispatch_item_ids");

  const db = getFirestore();
  let candidates: QueryDocumentSnapshot[] = [];
  if (ids && ids.length > 0) {
    for (const group of chunk(ids, IN_FILTER_LIMIT)) {
      const snap = await db
        .collection(COLLECTIONS.notificationDispatchItems)
        .where("driver_id", "==", driverId)
        .where("dismissed_at", "==", null)
        .where(FieldPath.documentId(), "in", group.map((id) => `${COLLECTIONS.notificationDispatchItems}/${id}`))
        .get();
      candidates.push(...snap.docs);
    }
  } else {
    const snap = await db
      .collection(COLLECTIONS.notificationDispatchItems)
      .where("driver_id", "==", driverId)
      .where("dismissed_at", "==", null)
      .limit(SCAN_CAP)
      .get();
    candidates = snap.docs;
  }

  if (candidates.length === 0) return 0;
  const now = FieldValue.serverTimestamp();

  for (const group of chunk(candidates, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const doc of group) {
      batch.update(doc.ref, { dismissed_at: now, updated_at: now });
    }
    batch.set(db.collection(COLLECTIONS.driverOperationEvents).doc(), {
      driver_id: driverId,
      module: "notification",
      action: "notification.dismiss",
      source: "rpc",
      actor: "driver_dismiss_notifications",
      success: true,
      record_type: "notification",
      record_id: null,
      detail: {
        count: group.length,
        scope: ids && ids.length > 0 ? "selected" : "all",
      },
      occurred_at: now,
    });
    await batch.commit();
  }

  return candidates.length;
});

/**
 * `notify_driver_transactional` — the campaign, its run and the single inbox row.
 *
 * Exposed as a callable because the panel's request/visit actions reach it
 * through `.rpc(...)`; the write itself is the shared helper the other modules
 * already call, so the wire shape cannot drift between an internal caller and an
 * external one.
 */
export const notifyDriverTransactional = onCall(async (request) => {
  await requireStaffAny(request, ["notifications.send", "deliveries.manage"]);

  const data = (request.data ?? {}) as Record<string, unknown>;
  const driverId = pickId(data, "driverId", "p_driver_id");
  const title = textOrNull(pick(data, "title", "p_title"));
  if (!driverId || !title) return { ok: false, error: "invalid_input" };

  const result = await writeTransactionalNotification({
    driverId,
    title,
    body: textOrNull(pick(data, "body", "p_body")) ?? title,
    deepLink: textOrNull(pick(data, "deepLink", "p_deep_link")),
    category: textOrNull(pick(data, "category", "p_category")) ?? "operations",
    priority: textOrNull(pick(data, "priority", "p_priority")) ?? "high",
    actionParams:
      typeof data.actionParams === "object" && data.actionParams !== null
        ? (data.actionParams as Record<string, unknown>)
        : typeof data.p_action_params === "object" && data.p_action_params !== null
          ? (data.p_action_params as Record<string, unknown>)
          : {},
  });

  return {
    ...result,
    deep_link: textOrNull(pick(data, "deepLink", "p_deep_link")),
  };
});

/**
 * `admin_expire_stale_pickups` — a stuck `in_transit` pickup blocks the rider from
 * logging any further order, so the sweep is a recovery path, not housekeeping.
 *
 * The SQL compared `COALESCE(pickup_at, created_at)`, which is two queries in
 * Firestore because a range on a missing field matches nothing. The second query
 * is the `pickup_at IS NULL` half, matched on `created_at`.
 */
export const adminExpireStalePickups = onCall(async (request) => {
  await requireStaffFresh(request, "deliveries.manage");

  const db = getFirestore();
  const settingsSnap = await db.collection(COLLECTIONS.appSettings).doc("main").get();
  const configured = Number(settingsSnap.data()?.pickup_auto_cancel_hours ?? 6);
  const hours = Math.max(Number.isFinite(configured) ? Math.trunc(configured) : 6, 1);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const [withPickup, withoutPickup] = await Promise.all([
    db
      .collection(COLLECTIONS.deliveries)
      .where("status", "==", "in_transit")
      .where("pickup_at", "<=", cutoff)
      .limit(SCAN_CAP)
      .get(),
    db
      .collection(COLLECTIONS.deliveries)
      .where("status", "==", "in_transit")
      .where("pickup_at", "==", null)
      .where("created_at", "<=", cutoff)
      .limit(SCAN_CAP)
      .get(),
  ]);

  const expired = [...withPickup.docs, ...withoutPickup.docs];
  if (expired.length === 0) return 0;

  const now = FieldValue.serverTimestamp();
  for (const group of chunk(expired, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const doc of group) {
      const existing = textOrNull(doc.get("cancel_reason"));
      const raw = (doc.data() ?? {}) as Record<string, unknown>;
      batch.update(doc.ref, {
        status: "cancelled",
        cancelled_at: now,
        cancel_reason:
          existing ??
          `Auto-cancelled: pickup not completed within ${hours}h`,
        ...stampStoredRow("deliveries", raw),
      });

      const driverId = doc.get("driver_id");
      if (typeof driverId === "string" && driverId !== "") {
        batch.set(db.collection(COLLECTIONS.driverOperationEvents).doc(), {
          driver_id: driverId,
          module: "delivery",
          action: "delivery.auto_cancel",
          source: "cron",
          actor: "admin_expire_stale_pickups",
          success: true,
          record_type: "delivery",
          record_id: doc.id,
          detail: {
            order_id: doc.get("external_order_id") ?? null,
            threshold_hours: hours,
            opened_at: doc.get("pickup_at") ?? doc.get("created_at") ?? null,
          },
          occurred_at: now,
        });
      }
    }
    await batch.commit();
  }

  for (const doc of expired) {
    const driverId = textOrNull(doc.get("driver_id"));
    if (!driverId) continue;
    const shift = textOrNull(doc.get("shift_date"));
    const createdDay = textOrNull(doc.get("created_day"));
    const pickup = doc.get("pickup_at");
    const pickupAt =
      pickup && typeof pickup === "object" && "toDate" in pickup
        ? (pickup as { toDate: () => Date }).toDate()
        : pickup instanceof Date
          ? pickup
          : null;
    const day =
      shift && /^\d{4}-\d{2}-\d{2}$/.test(shift)
        ? shift
        : createdDay && /^\d{4}-\d{2}-\d{2}$/.test(createdDay)
          ? createdDay
          : pickupAt
            ? kuwaitDayString(pickupAt)
            : "";
    const zone = textOrNull(doc.get("zone_id"));
    await applyDeliveryRollup(db, {
      deliveryId: doc.id,
      driverId,
      zoneId: zone,
      day,
      status: "cancelled",
    });
  }

  // An auto-cancelled pickup changes the week's delivery count for each rider it
  // belonged to. One flag write each (capped at 20), recomputed on their next
  // Home call.
  const touchedDrivers = [
    ...new Set(
      expired
        .map((doc) => textOrNull(doc.get("driver_id")))
        .filter((id): id is string => Boolean(id)),
    ),
  ].slice(0, 20);
  await Promise.all(
    touchedDrivers.map((driverId) => invalidateDriverHomeDailySafe(driverId, "expire")),
  );

  return expired.length;
});

/**
 * `driver_ops_audit_health` — the probe the retention cron surfaces to Sentry.
 *
 * The SQL asked Vault for a DSN and opened a dblink to prove the autonomous
 * audit path could still write. Firestore has no second connection to prove, so
 * `configured` / `reachable` are true by construction and only the 24-hour
 * failure count carries information.
 */
export const driverOpsAuditHealth = onCall(async (request) => {
  await requireStaff(request, "driver_ops.view");

  const db = getFirestore();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const failures = await db
    .collection(COLLECTIONS.driverOperationEvents)
    .where("success", "==", false)
    .where("occurred_at", ">", cutoff)
    .count()
    .get();

  return {
    configured: true,
    reachable: true,
    reason: null,
    failures_24h: failures.data().count,
  };
});

