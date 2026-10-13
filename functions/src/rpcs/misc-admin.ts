import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldPath,
  FieldValue,
  Timestamp,
  type QueryDocumentSnapshot,
} from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireStaff } from "../core/staff";
import { notifyDriverTransactional as writeTransactionalNotification } from "./visits-shared";

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
 * `driver_list_notifications` â€” the rider inbox.
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
  let query = db
    .collection(COLLECTIONS.notificationDispatchItems)
    .where("driver_id", "==", driverId)
    .where("dismissed_at", "==", null);

  if (before) query = query.where("created_at", "<", before);
  const snapshot = await query.orderBy("created_at", "desc").limit(limit).get();

  let rows = snapshot.docs;
  if (unreadOnly) rows = rows.filter((doc) => !doc.get("opened_at"));

  const campaignRefs = rows.map((doc) =>
    db.collection(COLLECTIONS.notificationCampaigns).doc(String(doc.get("campaign_id"))),
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

  const items = rows.map((doc) => {
    const item = doc.data() ?? {};
    const campaign = campaignById.get(String(item.campaign_id)) ?? {};
    return {
      dispatch_item_id: doc.id,
      campaign_id: item.campaign_id ?? null,
      delivered_at: item.delivered_at ?? null,
      opened_at: item.opened_at ?? null,
      clicked_at: item.clicked_at ?? null,
      received_at: item.created_at ?? null,
      title: item.resolved_title ?? campaign.title ?? null,
      body: item.resolved_body ?? campaign.body ?? null,
      category: campaign.category ?? null,
      priority: campaign.priority ?? null,
      action_type: campaign.action_type ?? null,
      action_params: campaign.action_params ?? null,
      media: campaign.media ?? null,
      payload_version: campaign.payload_version ?? null,
      screenshot_restricted: campaign.screenshot_restricted ?? false,
    };
  });

  return { items, unread_count: unreadSnap.data().count };
});

/**
 * `driver_mark_notifications_read`.
 *
 * Only rows that were unread are touched, so the returned count is the number the
 * rider actually cleared rather than the number they asked about â€” which is what
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

/** `driver_dismiss_notifications` â€” soft-clear, never a delete. */
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
 * `notify_driver_transactional` â€” the campaign, its run and the single inbox row.
 *
 * Exposed as a callable because the panel's request/visit actions reach it
 * through `.rpc(...)`; the write itself is the shared helper the other modules
 * already call, so the wire shape cannot drift between an internal caller and an
 * external one.
 */
export const notifyDriverTransactional = onCall(async (request) => {
  await requireStaff(request, "notifications.send");

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
 * `admin_expire_stale_pickups` â€” a stuck `in_transit` pickup blocks the rider from
 * logging any further order, so the sweep is a recovery path, not housekeeping.
 *
 * The SQL compared `COALESCE(pickup_at, created_at)`, which is two queries in
 * Firestore because a range on a missing field matches nothing. The second query
 * is the `pickup_at IS NULL` half, matched on `created_at`.
 */
export const adminExpireStalePickups = onCall(async (request) => {
  await requireStaff(request, "deliveries.manage");

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
      batch.update(doc.ref, {
        status: "cancelled",
        cancelled_at: now,
        cancel_reason:
          existing ??
          `Auto-cancelled: pickup not completed within ${hours}h`,
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

  return expired.length;
});

/**
 * `driver_ops_audit_health` â€” the probe the retention cron surfaces to Sentry.
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

