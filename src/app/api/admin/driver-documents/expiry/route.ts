import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireDriversManagerApi } from "@/lib/auth/require-drivers-manager";
import {
  DOCUMENT_TYPES,
  type DocumentExpiryConfig,
  type DriverDocumentType,
} from "@/features/drivers/types";
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

  const supabase = await createClient();
  const { data: intake } = await supabase
    .from("driver_intakes")
    .select("id, linked_profile_id")
    .eq("id", parsed.intakeId)
    .maybeSingle();

  if (!intake) {
    return NextResponse.json({ error: "save_failed" }, { status: 404 });
  }

  const linkedId = intake.linked_profile_id;
  if (parsed.driverProfileId && linkedId && parsed.driverProfileId !== linkedId) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  const targetDriverId = parsed.driverProfileId ?? linkedId;
  const { data: prior } = await supabase
    .from("document_tracking")
    .select("expires_at, track_expiry")
    .eq("intake_id", parsed.intakeId)
    .eq("doc_type", parsed.docType)
    .maybeSingle();

  const result = await upsertDocumentTracking({
    intakeId: parsed.intakeId,
    driverProfileId: targetDriverId,
    docType: parsed.docType,
    expiry: parsed.expiry,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const { logDriverChange } = await import("@/features/drivers/driver-change-log");
  const field = `document.${parsed.docType}.expiry`;
  void logDriverChange({
    intakeId: parsed.intakeId,
    driverId: targetDriverId,
    source: "document",
    before: {
      [field]: prior?.track_expiry ? (prior.expires_at ?? "tracked") : "off",
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
