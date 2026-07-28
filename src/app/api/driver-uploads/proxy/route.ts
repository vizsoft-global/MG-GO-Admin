import { NextResponse } from "next/server";
import { withCors } from "@/lib/http/cors";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";
import {
  buildDriverObjectKey,
  validateDriverUploadRequest,
} from "@/lib/storage/driver-upload-keys";
import { putObject } from "@/lib/storage/r2-client";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const auth = await requireDriverFromRequest(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }

  const entityType = String(formData.get("entityType") ?? "");
  const entityId =
    formData.get("entityId") != null
      ? String(formData.get("entityId"))
      : null;
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  const validation = validateDriverUploadRequest({
    entityType,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  });
  if ("error" in validation) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const objectKey = buildDriverObjectKey({
    driverId: auth.driverId,
    entityType: validation.entityType,
    originalFilename: file.name || "upload.bin",
  });

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await putObject(objectKey, buffer, file.type || "application/octet-stream", {
      uploadedBy: auth.authUid,
      entityType: validation.entityType,
      entityId: entityId ?? undefined,
      uploadedVia: "driver_proxy",
    });
  } catch {
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    objectKey,
    sizeBytes: buffer.length,
  });
}

export const POST = withCors(handler);
export const OPTIONS = withCors(handler);
