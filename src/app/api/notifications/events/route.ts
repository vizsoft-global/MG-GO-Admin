import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirebaseAuth, getFirebaseFirestore } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/db";

const CLIENT_EVENT_TYPES = [
  "delivered",
  "opened",
  "clicked",
  "failed",
  "token_invalid",
  "screenshot_taken",
] as const;
type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

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

const BANNED_SUBSTRING =
  /(token|password|passcode|secret|bearer|jwt|refresh|phone|mobile|msisdn|civil|national_id|iqama|address|street|email|stack|traceback|message|cookie|payload|header|body|auth)/;
const BANNED_NAME_WORD = /(^|_)(pin|otp|lat|lng|latitude|longitude|iban|dob)(_|$)/;
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

class ClientEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientEventError";
  }
}

function assertNever(value: never): never {
  throw new ClientEventError(`unhandled_client_event_type_${String(value)}`);
}

function asClientEventType(value: unknown): ClientEventType {
  if (typeof value === "string" && (CLIENT_EVENT_TYPES as readonly string[]).includes(value)) {
    return value as ClientEventType;
  }
  throw new ClientEventError("invalid_event_type");
}

function parseId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function parseInstant(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ClientEventError("invalid_event_at");
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new ClientEventError("invalid_event_at");
    return parsed;
  }
  throw new ClientEventError("invalid_event_at");
}

function asSpec(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

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

async function countDispatchItems(campaignId: string, field: string): Promise<number> {
  const db = await getFirebaseFirestore();
  if (!db) return 0;
  const snapshot = await db
    .collection(COLLECTIONS.notificationDispatchItems)
    .where("campaign_id", "==", campaignId)
    .where(field, "!=", null)
    .count()
    .get();
  return snapshot.data().count;
}

async function recordClientEvent(input: {
  driverId: string;
  eventType: ClientEventType;
  campaignId: string | null;
  dispatchItemId: string | null;
  eventAt: Date;
  metadata: Record<string, unknown>;
}): Promise<void> {
  if (!input.campaignId) throw new ClientEventError("not_authorized");

  const db = await getFirebaseFirestore();
  if (!db) throw new ClientEventError("not_configured");

  const itemRef = db.collection(COLLECTIONS.notificationDispatchItems).doc(input.dispatchItemId ?? "");
  const itemSnapshot = input.dispatchItemId ? await itemRef.get() : null;
  const item = itemSnapshot?.data() ?? null;
  if (
    !itemSnapshot?.exists ||
    !item ||
    asText(item.driver_id) !== input.driverId ||
    asText(item.campaign_id) !== input.campaignId
  ) {
    throw new ClientEventError("not_authorized");
  }

  await db.collection(COLLECTIONS.notificationClientEvents).add({
    campaign_id: input.campaignId,
    run_id: asText(item.run_id),
    dispatch_item_id: input.dispatchItemId,
    driver_id: input.driverId,
    event_type: input.eventType,
    metadata: input.metadata,
    occurred_at: Timestamp.fromDate(input.eventAt),
  });

  switch (input.eventType) {
    case "delivered":
    case "opened":
    case "clicked":
    case "failed":
    case "token_invalid": {
      const itemUpdate: Record<string, unknown> = {
        updated_at: FieldValue.serverTimestamp(),
      };
      if (input.eventType === "delivered") itemUpdate.delivered_at = Timestamp.fromDate(input.eventAt);
      if (input.eventType === "opened") itemUpdate.opened_at = Timestamp.fromDate(input.eventAt);
      if (input.eventType === "clicked") itemUpdate.clicked_at = Timestamp.fromDate(input.eventAt);
      if (input.eventType !== "failed" && input.eventType !== "token_invalid") {
        itemUpdate.status = input.eventType;
      }
      await itemRef.update(itemUpdate);

      const [delivered, opened, clicked] = await Promise.all([
        countDispatchItems(input.campaignId, "delivered_at"),
        countDispatchItems(input.campaignId, "opened_at"),
        countDispatchItems(input.campaignId, "clicked_at"),
      ]);

      const campaignUpdate: Record<string, unknown> = {
        delivered_count: delivered,
        opened_count: opened,
        clicked_count: clicked,
        updated_at: FieldValue.serverTimestamp(),
      };
      if (input.eventType === "delivered") campaignUpdate.status = "delivered";
      if (input.eventType === "opened") campaignUpdate.status = "opened";
      if (input.eventType === "clicked") campaignUpdate.status = "clicked";
      const campaignRef = db.collection(COLLECTIONS.notificationCampaigns).doc(input.campaignId);
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
      assertNever(input.eventType);
  }
}

export async function POST(request: Request): Promise<Response> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = header.slice(7).trim();
  const auth = await getFirebaseAuth();
  const db = await getFirebaseFirestore();
  if (!auth || !db || !token) {
    return NextResponse.json({ error: token ? "not_configured" : "unauthorized" }, { status: token ? 503 : 401 });
  }

  let driverId: string;
  try {
    driverId = (await auth.verifyIdToken(token)).uid;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    campaign_id?: string;
    dispatch_item_id?: string;
    event_type?: string;
    event_at?: string;
    meta?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.campaign_id || !body.dispatch_item_id || !body.event_type) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const eventType = asClientEventType(body.event_type);
    await recordClientEvent({
      driverId,
      eventType,
      campaignId: parseId(body.campaign_id),
      dispatchItemId: parseId(body.dispatch_item_id),
      eventAt: parseInstant(body.event_at) ?? new Date(),
      metadata: sanitizeNotificationContext(eventType, asSpec(body.meta ?? {})),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "event_failed";
    const status = message === "not_configured" ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true });
}
