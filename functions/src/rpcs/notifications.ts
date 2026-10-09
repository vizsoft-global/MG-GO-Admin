import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FieldValue, getFirestore, Timestamp } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { parseId, parseInstant } from "../core/query";
import { requireStaff } from "../core/staff";
import { asSpec, pickValue } from "./notification-audience";

/** `notification_automation_trigger` — the enum the RPC's parameter is cast to. */
const AUTOMATION_TRIGGERS = [
  "inactivity",
  "attendance_approved",
  "salary_processed",
  "document_expiry",
  "low_performance",
  "incentive_unlocked",
  "shift_reminder",
  "missed_submission",
  "schedule",
] as const;
type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

/** `notification_client_event_type` — the six values `record_notification_client_event` accepts. */
const CLIENT_EVENT_TYPES = [
  "delivered",
  "opened",
  "clicked",
  "failed",
  "token_invalid",
  "screenshot_taken",
] as const;
type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

/**
 * `driver_telemetry_event_types.context_keys` for the notification rows.
 *
 * The allowlist is load-bearing twice: it is what stops a new client key being
 * persisted without a server change, and it is what makes the name denylist
 * below safe to apply *over* it — `platform` survives only because the denylist
 * matches whole words, so `platform` is not the latitude `lat`.
 */
const NOTIFICATION_CONTEXT_KEYS: Readonly<Record<ClientEventType, readonly string[]>> = {
  delivered: [
    "screen",
    "duration_ms",
    "network_state",
    "app_version_name",
    "app_version_code",
    "platform",
  ],
  opened: ["screen", "from_screen", "app_version_name", "app_version_code", "platform"],
  clicked: ["action", "screen", "result", "app_version_name", "app_version_code", "platform"],
  failed: [
    "code",
    "reason",
    "http_status",
    "retryable",
    "app_version_name",
    "app_version_code",
    "platform",
  ],
  token_invalid: ["code", "reason", "platform", "app_version_name", "app_version_code"],
  screenshot_taken: [
    "screen",
    "from_screen",
    "app_version_name",
    "app_version_code",
    "platform",
  ],
};

/** `_telemetry_sanitize_context`'s denylist — overrides the allowlist above. */
const BANNED_SUBSTRING =
  /(token|password|passcode|secret|bearer|jwt|refresh|phone|mobile|msisdn|civil|national_id|iqama|address|street|email|stack|traceback|message|cookie|payload|header|body|auth)/;
const BANNED_NAME_WORD = /(^|_)(pin|otp|lat|lng|latitude|longitude|iban|dob)(_|$)/;

/** Keys whose value is an identifier, not prose, and must look like one. */
const IDENTIFIER_KEYS: ReadonlySet<string> = new Set([
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

function assertNever(value: never): never {
  throw new HttpsError("internal", `unhandled_client_event_type_${String(value)}`);
}

function asAutomationTrigger(value: unknown): AutomationTrigger {
  if (typeof value === "string" && (AUTOMATION_TRIGGERS as readonly string[]).includes(value)) {
    return value as AutomationTrigger;
  }
  throw new HttpsError("invalid-argument", "invalid_trigger_type");
}

function asClientEventType(value: unknown): ClientEventType {
  if (typeof value === "string" && (CLIENT_EVENT_TYPES as readonly string[]).includes(value)) {
    return value as ClientEventType;
  }
  throw new HttpsError("invalid-argument", "invalid_event_type");
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Scalars only, allowlisted keys only, and a sentence on an identifier key is
 * dropped rather than truncated — the same four rules the SQL applies in order.
 */
function sanitizeNotificationContext(
  eventType: ClientEventType,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set(NOTIFICATION_CONTEXT_KEYS[eventType]);
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key)) continue;
    const name = key.toLowerCase();
    if (BANNED_SUBSTRING.test(name) || BANNED_NAME_WORD.test(name)) continue;

    if (typeof value === "string") {
      if (IDENTIFIER_KEYS.has(key) && !IDENTIFIER_PATTERN.test(value)) continue;
      out[key] = value.slice(0, MAX_CONTEXT_STRING);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    }
  }

  return out;
}

/** One document per (trigger, key) — the automation queue's idempotency lock. */
function dedupeEventId(triggerType: AutomationTrigger, dedupeKey: string): string {
  return `${triggerType}__${dedupeKey}`;
}

async function countDispatchItems(campaignId: string, field: string): Promise<number> {
  const snapshot = await getFirestore()
    .collection(COLLECTIONS.notificationDispatchItems)
    .where("campaign_id", "==", campaignId)
    .where(field, "!=", null)
    .count()
    .get();
  return snapshot.data().count;
}

export const enqueueNotificationAutomationEvent = onCall(async (request) => {
  await requireStaff(request, "notifications.manage");
  const data = (request.data ?? {}) as Record<string, unknown>;
  const triggerType = asAutomationTrigger(
    pickValue(data, ["p_trigger_type", "triggerType", "trigger_type"]),
  );
  const driverId = parseId(pickValue(data, ["p_driver_id", "driverId", "driver_id"]));
  const payload = asSpec(pickValue(data, ["p_payload", "payload"]));
  const dedupeKey = parseId(pickValue(data, ["p_dedupe_key", "dedupeKey", "dedupe_key"]));

  const record = {
    trigger_type: triggerType,
    driver_id: driverId,
    payload,
    processed_at: null,
    created_at: FieldValue.serverTimestamp(),
  };

  const events = getFirestore().collection(COLLECTIONS.notificationAutomationEvents);
  if (!dedupeKey) {
    const created = await events.add(record);
    return created.id;
  }

  const ref = events.doc(dedupeEventId(triggerType, dedupeKey));
  try {
    await ref.create(record);
  } catch (error) {
    const existing = await ref.get();
    if (!existing.exists) throw error;
  }
  return ref.id;
});

export const recordNotificationClientEvent = onCall(async (request) => {
  const driverId = request.auth?.uid ?? null;
  if (!driverId) throw new HttpsError("unauthenticated", "not_authenticated");

  const data = (request.data ?? {}) as Record<string, unknown>;
  const eventType = asClientEventType(
    pickValue(data, ["p_event_type", "eventType", "event_type"]),
  );
  const campaignId = parseId(pickValue(data, ["p_campaign_id", "campaignId", "campaign_id"]));
  const dispatchItemId = parseId(
    pickValue(data, ["p_dispatch_item_id", "dispatchItemId", "dispatch_item_id"]),
  );
  const eventAt =
    parseInstant(pickValue(data, ["p_event_at", "eventAt", "event_at"]), "event_at") ?? new Date();
  const metadata = sanitizeNotificationContext(
    eventType,
    asSpec(pickValue(data, ["p_metadata", "metadata", "meta"])),
  );

  if (!campaignId) throw new HttpsError("permission-denied", "not_authorized");

  const db = getFirestore();
  const itemRef = db.collection(COLLECTIONS.notificationDispatchItems).doc(dispatchItemId ?? "");
  const itemSnapshot = dispatchItemId ? await itemRef.get() : null;
  const item = itemSnapshot?.data() ?? null;
  if (
    !itemSnapshot?.exists ||
    !item ||
    asText(item["driver_id"]) !== driverId ||
    asText(item["campaign_id"]) !== campaignId
  ) {
    throw new HttpsError("permission-denied", "not_authorized");
  }

  await db.collection(COLLECTIONS.notificationClientEvents).add({
    campaign_id: campaignId,
    run_id: asText(item["run_id"]),
    dispatch_item_id: dispatchItemId,
    driver_id: driverId,
    event_type: eventType,
    metadata,
    occurred_at: Timestamp.fromDate(eventAt),
  });

  switch (eventType) {
    case "delivered":
    case "opened":
    case "clicked":
    case "failed":
    case "token_invalid": {
      const itemUpdate: Record<string, unknown> = {
        updated_at: FieldValue.serverTimestamp(),
      };
      if (eventType === "delivered") itemUpdate["delivered_at"] = Timestamp.fromDate(eventAt);
      if (eventType === "opened") itemUpdate["opened_at"] = Timestamp.fromDate(eventAt);
      if (eventType === "clicked") itemUpdate["clicked_at"] = Timestamp.fromDate(eventAt);
      if (eventType !== "failed" && eventType !== "token_invalid") {
        itemUpdate["status"] = eventType;
      }
      await itemRef.update(itemUpdate);

      const [delivered, opened, clicked] = await Promise.all([
        countDispatchItems(campaignId, "delivered_at"),
        countDispatchItems(campaignId, "opened_at"),
        countDispatchItems(campaignId, "clicked_at"),
      ]);

      const campaignUpdate: Record<string, unknown> = {
        delivered_count: delivered,
        opened_count: opened,
        clicked_count: clicked,
        updated_at: FieldValue.serverTimestamp(),
      };
      if (eventType === "delivered") campaignUpdate["status"] = "delivered";
      if (eventType === "opened") campaignUpdate["status"] = "opened";
      if (eventType === "clicked") campaignUpdate["status"] = "clicked";
      const campaignRef = db.collection(COLLECTIONS.notificationCampaigns).doc(campaignId);
      try {
        await campaignRef.update(campaignUpdate);
      } catch (error) {
        const campaign = await campaignRef.get();
        if (campaign.exists) throw error;
      }
      break;
    }
    case "screenshot_taken":
      break;
    default:
      return assertNever(eventType);
  }

  return null;
});
