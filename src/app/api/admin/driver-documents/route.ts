import { NextResponse } from "next/server";
import { logDriverChange } from "@/features/drivers/driver-change-log";
import { requireDriversManagerApi } from "@/lib/auth/require-drivers-manager";
import { requireMutationAuth } from "@/lib/auth/require-mutation-auth";
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
  const mutationAuth = await requireMutationAuth();
  if ("error" in mutationAuth) return NextResponse.json({ error: mutationAuth.error }, { status: mutationAuth.error === "not_configured" ? 503 : 401 });
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
  const docTypeRaw = String(payload.docType ?? "").trim();
  const documentId = String(payload.documentId ?? "").trim();
  const isExtra = docTypeRaw === "extra";
  const docType = docTypeRaw as DriverDocumentType;

  if (!intakeId || (!isExtra && !DOCUMENT_TYPES.includes(docType))) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  if (isExtra && !documentId) {
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

  if (isExtra) {
    const extraRef = db.collection(COLLECTIONS.driverExtraDocuments).doc(documentId);
    const extra = await extraRef.get();
    const extraIntake = extra.get("intake_id");
    const extraDriver = extra.get("driver_id") ?? null;
    const ownsRow =
      extra.exists &&
      (extraIntake === intakeId ||
        (extraDriver != null && extraDriver === targetDriverId));
    if (!ownsRow) {
      return NextResponse.json({ error: "save_failed" }, { status: 404 });
    }

    const objectKey =
      typeof extra.get("file_url") === "string" ? extra.get("file_url").trim() : "";
    try {
      if (objectKey) await deleteObjects([objectKey]);
      await extraRef.delete();
    } catch {
      return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    }

    void logDriverChange({
      intakeId,
      driverId: targetDriverId,
      source: "document",
      before: { "document.extra": String(extra.get("title") ?? "uploaded") },
      after: { "document.extra": "absent" },
      context: { doc_type: "extra", title: String(extra.get("title") ?? "") },
    });

    return NextResponse.json({ ok: true });
  }

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
