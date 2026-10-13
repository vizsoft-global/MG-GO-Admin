import { NextResponse } from "next/server";
import { logDriverChange } from "@/features/drivers/driver-change-log";
import { requireDriversManagerApi } from "@/lib/auth/require-drivers-manager";
import {
  DOCUMENT_TYPES,
  type DriverDocumentType,
} from "@/features/drivers/types";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { allDocumentKeysForType } from "@/lib/storage/driver-documents";
import { deleteDocumentTracking } from "@/lib/storage/document-tracking";
import { deleteObjects } from "@/lib/storage/r2-client";

function linkedProfileId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

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

  const db = await staffDb();
  if (!db) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const intake = await db.collection(COLLECTIONS.driverIntakes).doc(intakeId).get();
  if (!intake.exists) {
    return NextResponse.json({ error: "save_failed" }, { status: 404 });
  }

  const linkedId = linkedProfileId(intake.get("linked_profile_id"));
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
    const docs = await db
      .collection(COLLECTIONS.driverDocuments)
      .where("driver_id", "==", targetDriverId)
      .get();
    const matches = docs.docs.filter((doc) => doc.get("doc_type") === docType);
    for (let index = 0; index < matches.length; index += 400) {
      const batch = db.batch();
      for (const doc of matches.slice(index, index + 400)) batch.delete(doc.ref);
      await batch.commit();
    }
  }

  await deleteDocumentTracking({
    intakeId,
    driverProfileId: targetDriverId,
    docType,
  });

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
