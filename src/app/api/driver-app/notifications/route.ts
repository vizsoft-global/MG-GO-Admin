import { NextResponse } from "next/server";
import {
  FieldValue,
  Timestamp,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { withCors } from "@/lib/http/cors";
import { getFirebaseAuth, getFirebaseFirestore } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/db";

const IN_FILTER_LIMIT = 30;
const INBOX_LIMIT = 100;
const SCAN_CAP = 1000;
/** Three writes per item (update + event + op log) must stay under Firestore's 500-op batch cap. */
const MARK_BATCH = 150;
const DISMISS_BATCH = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function pickInstant(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function jsonValue(value: unknown): unknown {
  if (value == null) return value ?? null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.toDate === "function") {
      const date = (record as { toDate: () => Date }).toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) return date.toISOString();
    }
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) out[key] = jsonValue(nested);
    return out;
  }
  return value;
}

async function bearerUid(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const auth = await getFirebaseAuth();
  if (!auth) return null;
  try {
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

async function loadByIds(
  db: Firestore,
  driverId: string,
  ids: string[],
  openField: "opened_at" | "dismissed_at",
): Promise<QueryDocumentSnapshot[]> {
  const candidates: QueryDocumentSnapshot[] = [];
  for (const group of chunk(ids, IN_FILTER_LIMIT)) {
    const refs = group.map((id) => db.collection(COLLECTIONS.notificationDispatchItems).doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (!snap.exists) continue;
      if (snap.get("driver_id") !== driverId) continue;
      if (snap.get(openField) != null) continue;
      candidates.push(snap as QueryDocumentSnapshot);
    }
  }
  return candidates;
}

async function listNotifications(
  db: Firestore,
  driverId: string,
  limit: number,
  before: Date | null,
  unreadOnly: boolean,
) {
  let query = db
    .collection(COLLECTIONS.notificationDispatchItems)
    .where("driver_id", "==", driverId)
    .where("dismissed_at", "==", null);
  if (before) query = query.where("created_at", "<", before);
  const snapshot = await query.orderBy("created_at", "desc").limit(limit).get();

  let rows = snapshot.docs;
  if (unreadOnly) rows = rows.filter((doc) => !doc.get("opened_at"));

  const campaignIds = [
    ...new Set(
      rows
        .map((doc) => doc.get("campaign_id"))
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const campaignById = new Map<string, Record<string, unknown>>();
  for (const group of chunk(campaignIds, IN_FILTER_LIMIT)) {
    const snaps = await db.getAll(
      ...group.map((id) => db.collection(COLLECTIONS.notificationCampaigns).doc(id)),
    );
    for (const snap of snaps) campaignById.set(snap.id, snap.data() ?? {});
  }

  const visible = await db
    .collection(COLLECTIONS.notificationDispatchItems)
    .where("driver_id", "==", driverId)
    .where("dismissed_at", "==", null)
    .select("opened_at")
    .get();
  const unreadCount = visible.docs.filter((doc) => !doc.get("opened_at")).length;

  const items = rows.map((doc) => {
    const item = doc.data() ?? {};
    const campaign = campaignById.get(String(item.campaign_id ?? "")) ?? {};
    return {
      dispatch_item_id: doc.id,
      campaign_id: item.campaign_id ?? null,
      delivered_at: jsonValue(item.delivered_at ?? null),
      opened_at: jsonValue(item.opened_at ?? null),
      clicked_at: jsonValue(item.clicked_at ?? null),
      received_at: jsonValue(item.created_at ?? null),
      title: item.resolved_title ?? campaign.title ?? null,
      body: item.resolved_body ?? campaign.body ?? null,
      category: campaign.category ?? null,
      priority: campaign.priority ?? null,
      action_type: campaign.action_type ?? null,
      action_params: jsonValue(campaign.action_params ?? null),
      media: jsonValue(campaign.media ?? null),
      payload_version: campaign.payload_version ?? null,
      screenshot_restricted: campaign.screenshot_restricted ?? false,
    };
  });

  return { items, unread_count: unreadCount };
}

async function markRead(db: Firestore, driverId: string, ids: string[] | null): Promise<number> {
  let candidates: QueryDocumentSnapshot[] = [];
  if (ids && ids.length > 0) {
    candidates = await loadByIds(db, driverId, ids, "opened_at");
  } else {
    const snap = await db
      .collection(COLLECTIONS.notificationDispatchItems)
      .where("driver_id", "==", driverId)
      .where("dismissed_at", "==", null)
      .orderBy("created_at", "desc")
      .limit(SCAN_CAP)
      .get();
    candidates = snap.docs.filter((doc) => doc.get("opened_at") == null);
  }

  if (candidates.length === 0) return 0;
  const scope = ids && ids.length > 0 ? "selected" : "all";

  for (const group of chunk(candidates, MARK_BATCH)) {
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
        detail: { count: group.length, scope },
        occurred_at: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  return candidates.length;
}

async function dismiss(db: Firestore, driverId: string, ids: string[] | null): Promise<number> {
  let candidates: QueryDocumentSnapshot[] = [];
  if (ids && ids.length > 0) {
    candidates = await loadByIds(db, driverId, ids, "dismissed_at");
  } else {
    const snap = await db
      .collection(COLLECTIONS.notificationDispatchItems)
      .where("driver_id", "==", driverId)
      .where("dismissed_at", "==", null)
      .orderBy("created_at", "desc")
      .limit(SCAN_CAP)
      .get();
    candidates = snap.docs;
  }

  if (candidates.length === 0) return 0;
  const scope = ids && ids.length > 0 ? "selected" : "all";
  const now = FieldValue.serverTimestamp();

  for (const group of chunk(candidates, DISMISS_BATCH)) {
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
      detail: { count: group.length, scope },
      occurred_at: now,
    });
    await batch.commit();
  }

  return candidates.length;
}

function idList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return ids;
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const auth = await getFirebaseAuth();
  const db = await getFirebaseFirestore();
  if (!auth || !db) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const driverId = await bearerUid(request);
  if (!driverId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);

    if (request.method === "GET") {
      const limitRaw = Number(searchParams.get("limit") ?? "50");
      const limit = Math.min(
        Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 50, 1),
        INBOX_LIMIT,
      );
      const data = await listNotifications(
        db,
        driverId,
        limit,
        pickInstant(searchParams.get("before")),
        searchParams.get("unread_only") === "1",
      );
      return NextResponse.json(data);
    }

    let body: { dispatch_item_ids?: string[] } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const ids = idList(body.dispatch_item_ids);

    if (request.method === "DELETE") {
      const updated = await dismiss(db, driverId, ids);
      return NextResponse.json({ updated });
    }

    const updated = await markRead(db, driverId, ids);
    return NextResponse.json({ updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "notification_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export const GET = withCors(handler);
export const POST = withCors(handler);
export const DELETE = withCors(handler);
export const OPTIONS = withCors(handler);
