import { NextResponse } from "next/server";
import { withCors } from "@/lib/http/cors";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";
import { headObject } from "@/lib/storage/r2-client";
import { confirmPendingUpload, STORAGE_UPLOADS } from "@/lib/storage/storage-upload-audit";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const auth = await requireDriverFromRequest(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const uploadId = String((body as Record<string, unknown>).uploadId ?? "");
  if (!uploadId) {
    return NextResponse.json({ error: "missing_upload_id" }, { status: 400 });
  }

  const db = await getFirebaseFirestore();
  if (!db) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const snap = await db.collection(STORAGE_UPLOADS).doc(uploadId).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const row = snap.data() ?? {};
  const objectKey = typeof row.object_key === "string" ? row.object_key : "";
  if (row.uploaded_by !== auth.authUid) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }
  if (row.status !== "pending") {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const head = await headObject(objectKey);
  if (!head.exists || head.size == null) {
    return NextResponse.json({ error: "object_not_found" }, { status: 400 });
  }

  const result = await confirmPendingUpload(
    uploadId,
    auth.authUid,
    head.size,
  );

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    objectKey: result.objectKey,
    sizeBytes: head.size,
  });
}

export const POST = withCors(handler);
export const OPTIONS = withCors(handler);
