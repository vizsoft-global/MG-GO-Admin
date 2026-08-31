import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireDriversManagerApi } from "@/lib/auth/require-drivers-manager";
import {
  DOCUMENT_TYPES,
  type DriverDocumentType,
} from "@/features/drivers/types";
import { allDocumentKeysForType } from "@/lib/storage/driver-documents";
import { deleteDocumentTracking } from "@/lib/storage/document-tracking";
import { deleteObjects } from "@/lib/storage/r2-client";

export async function DELETE(request: Request): Promise<Response> {
  const auth = await requireDriversManagerApi();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const intakeId = String(payload.intakeId ?? "").trim();
  const driverProfileIdRaw = String(payload.driverProfileId ?? "").trim();
  const driverProfileId = driverProfileIdRaw || null;
  const docType = String(payload.docType ?? "").trim() as DriverDocumentType;

  if (!intakeId || !DOCUMENT_TYPES.includes(docType)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: intake } = await supabase
    .from("driver_intakes")
    .select("id, linked_profile_id")
    .eq("id", intakeId)
    .maybeSingle();

  if (!intake) {
    return NextResponse.json({ error: "save_failed" }, { status: 404 });
  }

  const linkedId = intake.linked_profile_id;
  if (driverProfileId && linkedId && driverProfileId !== linkedId) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  const targetDriverId = driverProfileId ?? linkedId;

  try {
    await deleteObjects(
      allDocumentKeysForType(intakeId, targetDriverId, docType),
    );
  } catch {
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  if (targetDriverId) {
    await supabase
      .from("driver_documents")
      .delete()
      .eq("driver_id", targetDriverId)
      .eq("doc_type", docType);
  }

  await deleteDocumentTracking({
    intakeId,
    driverProfileId: targetDriverId,
    docType,
  });

  const { logDriverChange } = await import("@/features/drivers/driver-change-log");
  void logDriverChange({
    intakeId,
    driverId: targetDriverId,
    source: "document",
    before: { [`document.${docType}`]: "uploaded" },
    after: { [`document.${docType}`]: "absent" },
    context: { doc_type: docType },
  });

  return NextResponse.json({ ok: true });
}
