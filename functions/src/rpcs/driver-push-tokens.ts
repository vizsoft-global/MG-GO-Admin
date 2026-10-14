/**
 * Rider FCM token upsert / deactivate, plus the transactional send used by
 * `notifyDriverTransactional`.
 *
 * The rider app cannot write `driver_push_tokens` — Firestore rules deny it —
 * so these two callables are the only door. Campaign dispatch and DPD cron
 * already read the same collection.
 */
import { createHash } from "node:crypto";
import { getMessaging } from "firebase-admin/messaging";
import { onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireRider, riderError } from "../core/rider";
import { pickText, type Dict } from "./_shared";

export const DEAD_FCM_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
  "messaging/sender-id-mismatch",
  "messaging/mismatched-credential",
]);

export type PushPlatform = "ios" | "android";

export type ActivePushToken = {
  id: string;
  driver_id: string;
  token: string;
  last_seen_at: string | null;
  is_active: boolean;
};

export type TransactionalPushStatus = "sent" | "no_token" | "failed";

export type TransactionalPushResult = {
  pushed: boolean;
  status: TransactionalPushStatus;
  error_code?: string;
  provider_message_id?: string;
  token_id?: string;
};

export type TransactionalPushInput = {
  driverId: string;
  title: string;
  body: string;
  campaignId: string;
  dispatchItemId: string;
  category: string;
  priority: string;
  deepLink?: string | null;
  actionParams?: Record<string, unknown>;
};

type TokenSendEach = (token: string, title: string, body: string, data: Record<string, string>) => Promise<{
  success: boolean;
  messageId?: string;
  code?: string;
}>;

export function pushTokenDocId(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function normalizePushPlatform(raw: unknown): PushPlatform | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value === "ios" || value === "android") return value;
  return null;
}

/** Firestore `== null` matches only an explicit null, not a missing field. */
export function inboxOpenFields(): { dismissed_at: null; opened_at: null } {
  return { dismissed_at: null, opened_at: null };
}

export function isInboxVisible(data: { dismissed_at?: unknown }): boolean {
  return data.dismissed_at == null;
}

export function isInboxUnread(data: { dismissed_at?: unknown; opened_at?: unknown }): boolean {
  return data.dismissed_at == null && data.opened_at == null;
}

export function isDeadFcmCode(code: string): boolean {
  return DEAD_FCM_CODES.has(code);
}

export function pickLatestActivePushToken(rows: ActivePushToken[]): ActivePushToken | null {
  let picked: ActivePushToken | null = null;
  let pickedSeen = -1;
  for (const row of rows) {
    if (!row.is_active || !row.token.trim()) continue;
    const seen = Date.parse(row.last_seen_at ?? "") || 0;
    if (!picked || seen >= pickedSeen) {
      picked = row;
      pickedSeen = seen;
    }
  }
  return picked;
}

export function buildTransactionalFcmData(input: TransactionalPushInput): Record<string, string> {
  const deepLink = input.deepLink?.trim() ?? "";
  return {
    campaign_id: input.campaignId,
    dispatch_item_id: input.dispatchItemId,
    payload_version: "2",
    action_type: "open_record",
    action_params: JSON.stringify(input.actionParams ?? {}),
    category: input.category,
    priority: input.priority,
    screenshot_restricted: "0",
    ...(deepLink ? { deep_link: deepLink } : {}),
  };
}

function lastSeenIso(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (
    value !== null &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function readTokenRow(id: string, data: Record<string, unknown>): ActivePushToken {
  return {
    id,
    driver_id: typeof data.driver_id === "string" ? data.driver_id : "",
    token: typeof data.token === "string" ? data.token : "",
    last_seen_at: lastSeenIso(data.last_seen_at),
    is_active: data.is_active === true,
  };
}

export async function loadActivePushTokens(driverId: string): Promise<ActivePushToken[]> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.driverPushTokens)
    .where("driver_id", "==", driverId)
    .get();
  return snap.docs.map((doc) => readTokenRow(doc.id, doc.data() as Record<string, unknown>));
}

async function defaultSendEach(
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<{ success: boolean; messageId?: string; code?: string }> {
  const messaging = getMessaging();
  const response = await messaging.sendEach([
    {
      token,
      notification: { title, body },
      data,
      android: { priority: "high" },
      apns: {
        headers: { "apns-priority": "10" },
        payload: { aps: { sound: "default" } },
      },
    },
  ]);
  const item = response.responses[0];
  if (item?.success && item.messageId) {
    return { success: true, messageId: item.messageId };
  }
  return { success: false, code: item?.error?.code ?? "unknown" };
}

export async function sendTransactionalPushToDriver(
  input: TransactionalPushInput,
  sendEach: TokenSendEach = defaultSendEach,
): Promise<TransactionalPushResult> {
  const tokens = await loadActivePushTokens(input.driverId);
  const latest = pickLatestActivePushToken(tokens);
  if (!latest) return { pushed: false, status: "no_token" };

  try {
    const sent = await sendEach(
      latest.token,
      input.title,
      input.body,
      buildTransactionalFcmData(input),
    );
    if (sent.success && sent.messageId) {
      return {
        pushed: true,
        status: "sent",
        provider_message_id: sent.messageId,
        token_id: latest.id,
      };
    }
    const code = sent.code ?? "unknown";
    if (isDeadFcmCode(code)) {
      await getFirestore().collection(COLLECTIONS.driverPushTokens).doc(latest.id).update({
        is_active: false,
        updated_at: new Date().toISOString(),
      });
    }
    return { pushed: false, status: "failed", error_code: code, token_id: latest.id };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "unknown";
    return { pushed: false, status: "failed", error_code: code, token_id: latest.id };
  }
}

export async function applyTransactionalPushResult(
  itemId: string,
  runId: string,
  campaignId: string,
  result: TransactionalPushResult,
): Promise<void> {
  const now = FieldValue.serverTimestamp();
  const db = getFirestore();
  const itemUpdate: Dict = {
    error_code: result.error_code ?? null,
    updated_at: now,
  };
  if (result.status === "sent") {
    itemUpdate.status = "delivered";
    itemUpdate.provider_message_id = result.provider_message_id ?? null;
    itemUpdate.push_token_id = result.token_id ?? null;
    itemUpdate.sent_at = now;
  } else if (result.status === "no_token") {
    itemUpdate.error_code = "no_token";
    itemUpdate.error_message = "No active push token";
  } else {
    itemUpdate.status = "failed";
    itemUpdate.error_message = result.error_code ?? "send_failed";
  }

  const writes: Array<Promise<unknown>> = [
    db.collection(COLLECTIONS.notificationDispatchItems).doc(itemId).update(itemUpdate),
    db.collection(COLLECTIONS.notificationDispatchRuns).doc(runId).update({
      sent_count: result.pushed ? 1 : 0,
      failed_count: result.status === "failed" ? 1 : 0,
      updated_at: now,
    }),
    db.collection(COLLECTIONS.notificationCampaigns).doc(campaignId).update({
      delivered_count: result.pushed ? 1 : 0,
      failed_count: result.status === "failed" ? 1 : 0,
      updated_at: now,
    }),
  ];
  await Promise.all(writes);
}

export const driverUpsertPushToken = onCall(async (request) => {
  const rider = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const token = pickText(data, "token", "p_token");
  if (!token || token.length < 16 || token.length > 4096) {
    throw riderError("invalid-argument", "token_required");
  }
  const platform = normalizePushPlatform(pickText(data, "platform", "p_platform") ?? "android");
  if (!platform) throw riderError("invalid-argument", "invalid_platform");

  const db = getFirestore();
  const id = pushTokenDocId(token);
  const nowIso = new Date().toISOString();
  const ref = db.collection(COLLECTIONS.driverPushTokens).doc(id);
  const existing = await ref.get();

  await ref.set(
    {
      driver_id: rider.uid,
      token,
      platform,
      is_active: true,
      last_seen_at: nowIso,
      updated_at: nowIso,
      ...(existing.exists ? {} : { created_at: nowIso }),
    },
    { merge: true },
  );

  const siblings = await db.collection(COLLECTIONS.driverPushTokens).where("driver_id", "==", rider.uid).get();
  const batch = db.batch();
  let pending = 0;
  for (const doc of siblings.docs) {
    if (doc.id === id) continue;
    if (doc.data().is_active !== true) continue;
    batch.update(doc.ref, { is_active: false, updated_at: nowIso });
    pending += 1;
  }
  if (pending > 0) await batch.commit();

  return { ok: true, id };
});

export const driverDeactivatePushToken = onCall(async (request) => {
  const rider = await requireRider(request);
  const data = (request.data ?? {}) as Dict;
  const token = pickText(data, "token", "p_token");
  if (!token) throw riderError("invalid-argument", "token_required");

  const ref = getFirestore().collection(COLLECTIONS.driverPushTokens).doc(pushTokenDocId(token));
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, deactivated: false };
  if (snap.data()?.driver_id !== rider.uid) {
    throw riderError("permission-denied", "not_own_token");
  }
  await ref.update({
    is_active: false,
    updated_at: new Date().toISOString(),
  });
  return { ok: true, deactivated: true };
});
