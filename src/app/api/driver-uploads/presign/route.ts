import { NextResponse } from "next/server";
import { withCors } from "@/lib/http/cors";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";
import {
  buildDriverObjectKey,
  validateDriverUploadRequest,
} from "@/lib/storage/driver-upload-keys";
import { getPresignedPutUrl } from "@/lib/storage/r2-client";
import { createPendingUpload } from "@/lib/storage/storage-upload-audit";

const PRESIGN_TTL_SECONDS = 600;

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

  const payload = body as Record<string, unknown>;
  const entityType = String(payload.entityType ?? "");
  const entityId = payload.entityId != null ? String(payload.entityId) : null;
  const contentType = String(payload.contentType ?? "");
  const filename = String(payload.filename ?? "upload.bin");
  const sizeBytes = Number(payload.sizeBytes ?? 0);

  const validation = validateDriverUploadRequest({
    entityType,
    contentType,
    sizeBytes,
  });
  if ("error" in validation) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const objectKey = buildDriverObjectKey({
    driverId: auth.driverId,
    entityType: validation.entityType,
    originalFilename: filename,
  });

  const expiresAt = new Date(
    Date.now() + PRESIGN_TTL_SECONDS * 1000,
  ).toISOString();

  const pending = await createPendingUpload({
    objectKey,
    contentType,
    entityType: validation.entityType,
    entityId,
    uploadedBy: auth.authUid,
    expiresAt,
  });

  if ("error" in pending) {
    return NextResponse.json({ error: pending.error }, { status: 409 });
  }

  try {
    const uploadUrl = await getPresignedPutUrl(
      objectKey,
      contentType,
      PRESIGN_TTL_SECONDS,
    );

    return NextResponse.json({
      uploadId: pending.id,
      uploadUrl,
      objectKey,
      expiresAt,
      requiredHeaders: { "Content-Type": contentType },
    });
  } catch {
    return NextResponse.json({ error: "presign_failed" }, { status: 500 });
  }
}

export const POST = withCors(handler);
export const OPTIONS = withCors(handler);
