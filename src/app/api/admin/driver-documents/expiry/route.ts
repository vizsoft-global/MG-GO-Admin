import { NextResponse } from "next/server";
import { logDriverChange } from "@/features/drivers/driver-change-log";
import { requireDriversManagerApi } from "@/lib/auth/require-drivers-manager";
import {
  DOCUMENT_TYPES,
  type DocumentExpiryConfig,
  type DriverDocumentType,
} from "@/features/drivers/types";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  parseNotifyLeadDays,
  upsertDocumentTracking,
} from "@/lib/storage/document-tracking";

type ExpiryPayload = {
  intakeId?: string;
  driverProfileId?: string | null;
  docType?: string;
  trackExpiry?: boolean;
  expiresAt?: string | null;
  notifyEnabled?: boolean;
  notifyLeadDays?: number[] | string;
};

function parseExpiryBody(body: ExpiryPayload): {
  intakeId: string;
  driverProfileId: string | null;
  docType: DriverDocumentType;
  expiry: DocumentExpiryConfig;
} | null {
  const intakeId = String(body.intakeId ?? "").trim();
  const driverProfileIdRaw = String(body.driverProfileId ?? "").trim();
  const driverProfileId = driverProfileIdRaw || null;
  const docType = String(body.docType ?? "").trim() as DriverDocumentType;

  if (!intakeId || !DOCUMENT_TYPES.includes(docType)) return null;

  const trackExpiry = Boolean(body.trackExpiry);
  const expiresAtRaw = String(body.expiresAt ?? "").trim();
  const notifyEnabled = body.notifyEnabled !== false;
  const notifyLeadDays = Array.isArray(body.notifyLeadDays)
    ? body.notifyLeadDays.filter((n) => Number.isFinite(n))
    : parseNotifyLeadDays(
        typeof body.notifyLeadDays === "string" ? body.notifyLeadDays : "",
      );

  return {
    intakeId,
    driverProfileId,
    docType,
    expiry: {
      trackExpiry,
      expiresAt: trackExpiry && expiresAtRaw ? expiresAtRaw : null,
      notifyEnabled: trackExpiry && notifyEnabled,
      notifyLeadDays,
    },
  };
}

function linkedProfileId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function expiresText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

export async function PATCH(request: Request): Promise<Response> {
  const auth = await requireDriversManagerApi();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  let body: ExpiryPayload;
  try {
    body = (await request.json()) as ExpiryPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseExpiryBody(body);
  if (!parsed) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const db = await staffDb();
  if (!db) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const intake = await db.collection(COLLECTIONS.driverIntakes).doc(parsed.intakeId).get();
  if (!intake.exists) {
    return NextResponse.json({ error: "save_failed" }, { status: 404 });
  }

  const linkedId = linkedProfileId(intake.get("linked_profile_id"));
  if (parsed.driverProfileId && linkedId && parsed.driverProfileId !== linkedId) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  const targetDriverId = parsed.driverProfileId ?? linkedId;
  const priorSnap = await db
    .collection(COLLECTIONS.documentTracking)
    .where("intake_id", "==", parsed.intakeId)
    .limit(50)
    .get();
  const priorRows = priorSnap.docs.filter((doc) => doc.get("doc_type") === parsed.docType);
  const prior = priorRows.length === 1 ? priorRows[0] : null;

  const result = await upsertDocumentTracking({
    intakeId: parsed.intakeId,
    driverProfileId: targetDriverId,
    docType: parsed.docType,
    expiry: parsed.expiry,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const field = `document.${parsed.docType}.expiry`;
  const priorExpiry = expiresText(prior?.get("expires_at"));
  void logDriverChange({
    intakeId: parsed.intakeId,
    driverId: targetDriverId,
    source: "document",
    before: {
      [field]: prior?.get("track_expiry") ? (priorExpiry ?? "tracked") : "off",
    },
    after: {
      [field]: parsed.expiry.trackExpiry
        ? (parsed.expiry.expiresAt ?? "tracked")
        : "off",
    },
    context: { doc_type: parsed.docType },
  });

  return NextResponse.json({ ok: true });
}
