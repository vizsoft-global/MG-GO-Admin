import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireDriversManagerApi } from "@/lib/auth/require-drivers-manager";
import { validateDocumentFile } from "@/features/drivers/driver-form-validation";
import {
  DOCUMENT_TYPES,
  type DriverDocumentType,
} from "@/features/drivers/types";
import { isR2Configured } from "@/lib/storage/r2-config";
import {
  allDocumentKeysForType,
  listExistingDriverDocuments,
} from "@/lib/storage/driver-documents";
import {
  parseExpiryConfigFromForm,
  upsertDocumentTracking,
} from "@/lib/storage/document-tracking";
import {
  buildDriverDocumentKey,
  buildIntakeDocumentKey,
  extensionFromMime,
} from "@/lib/storage/r2-keys";
import { deleteObjects, putObject } from "@/lib/storage/r2-client";

export async function POST(request: Request): Promise<Response> {
  const auth = await requireDriversManagerApi();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }

  if (!(await isR2Configured())) {
    return NextResponse.json({ error: "r2_not_configured" }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const intakeId = String(formData.get("intakeId") ?? "").trim();
  const driverProfileIdRaw = String(formData.get("driverProfileId") ?? "").trim();
  const driverProfileId = driverProfileIdRaw || null;
  const docType = String(formData.get("docType") ?? "").trim() as DriverDocumentType;
  const file = formData.get("file");

  if (!intakeId || !DOCUMENT_TYPES.includes(docType)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  const fileError = validateDocumentFile(file);
  if (fileError) {
    return NextResponse.json({ error: fileError }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: intake } = await supabase
    .from("driver_intakes")
    .select("id, linked_profile_id")
    .eq("id", intakeId)
    .is("archived_at", null)
    .maybeSingle();

  if (!intake) {
    return NextResponse.json({ error: "save_failed" }, { status: 404 });
  }

  const linkedId = intake.linked_profile_id;
  if (driverProfileId && linkedId && driverProfileId !== linkedId) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  const ext = extensionFromMime(file.type);
  const useDriverPath = Boolean(driverProfileId ?? linkedId);
  const targetDriverId = driverProfileId ?? linkedId;
  const objectKey = useDriverPath && targetDriverId
    ? buildDriverDocumentKey(targetDriverId, docType, ext)
    : buildIntakeDocumentKey(intakeId, docType, ext);

  const source: "driver" | "intake" =
    useDriverPath && targetDriverId ? "driver" : "intake";

  const existingDocs = await listExistingDriverDocuments(intakeId, targetDriverId);
  const hadDoc = Boolean(existingDocs[docType]);

  const keysToClear = allDocumentKeysForType(
    intakeId,
    targetDriverId,
    docType,
  ).filter((k) => k !== objectKey);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(objectKey, buffer, file.type, {
      uploadedBy: auth.session.id,
      entityType: source === "driver" ? "driver" : "driver_intake",
      entityId: targetDriverId ?? intakeId,
      uploadedVia: "admin",
    });
    if (keysToClear.length > 0) {
      await deleteObjects(keysToClear);
    }
  } catch {
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  if (source === "driver" && targetDriverId) {
    const expiry = parseExpiryConfigFromForm(formData, docType);

    await supabase
      .from("driver_documents")
      .delete()
      .eq("driver_id", targetDriverId)
      .eq("doc_type", docType);

    const { error: insertErr } = await supabase.from("driver_documents").insert({
      driver_id: targetDriverId,
      doc_type: docType,
      file_url: objectKey,
      expires_at: expiry.trackExpiry ? expiry.expiresAt : null,
      updated_at: new Date().toISOString(),
    });

    if (insertErr) {
      return NextResponse.json({ error: "save_failed" }, { status: 500 });
    }

    const trackingResult = await upsertDocumentTracking({
      intakeId,
      driverProfileId: targetDriverId,
      docType,
      objectKey,
      expiry,
    });
    if (trackingResult.error) {
      return NextResponse.json({ error: trackingResult.error }, { status: 500 });
    }
  } else {
    const expiry = parseExpiryConfigFromForm(formData, docType);
    const trackingResult = await upsertDocumentTracking({
      intakeId,
      driverProfileId: null,
      docType,
      objectKey,
      expiry,
    });
    if (trackingResult.error) {
      return NextResponse.json({ error: trackingResult.error }, { status: 500 });
    }
  }

  const docs = await listExistingDriverDocuments(
    intakeId,
    targetDriverId,
  );
  const doc = docs[docType];
  if (!doc) {
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  const { logDriverChange } = await import("@/features/drivers/driver-change-log");
  void logDriverChange({
    intakeId,
    driverId: targetDriverId,
    source: "document",
    before: { [`document.${docType}`]: hadDoc ? "uploaded" : "absent" },
    after: { [`document.${docType}`]: hadDoc ? "replaced" : "uploaded" },
    context: { doc_type: docType },
  });

  return NextResponse.json({
    ok: true,
    objectKey: doc.objectKey,
    signedUrl: doc.signedUrl,
    sizeBytes: doc.sizeBytes,
    contentType: doc.contentType,
    source: doc.source,
  });
}
