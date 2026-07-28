import { createAdminClient } from "@/lib/supabase/admin";
import { resolveR2Config } from "@/lib/storage/r2-config";

export type StorageUploadVia = "admin" | "driver_presigned" | "driver_proxy";
export type StorageUploadStatus = "pending" | "completed" | "failed" | "expired";

export type RecordUploadParams = {
  objectKey: string;
  sizeBytes: number;
  contentType?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  uploadedBy?: string | null;
  uploadedVia: StorageUploadVia;
  status?: StorageUploadStatus;
  expiresAt?: string | null;
  confirmedAt?: string | null;
};

async function bucketName(): Promise<string> {
  const config = await resolveR2Config();
  return config.bucketName;
}

export async function recordStorageUpload(
  params: RecordUploadParams,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const bucket = await bucketName();
    const now = new Date().toISOString();

    await admin.from("storage_uploads").upsert(
      {
        object_key: params.objectKey,
        bucket,
        size_bytes: params.sizeBytes,
        content_type: params.contentType ?? null,
        entity_type: params.entityType ?? null,
        entity_id: params.entityId ?? null,
        uploaded_by: params.uploadedBy ?? null,
        uploaded_via: params.uploadedVia,
        status: params.status ?? "completed",
        expires_at: params.expiresAt ?? null,
        confirmed_at: params.confirmedAt ?? (params.status === "completed" ? now : null),
        uploaded_at: now,
      },
      { onConflict: "object_key" },
    );
  } catch (e) {
    console.error("[storage_uploads] audit insert failed", e);
  }
}

export async function createPendingUpload(params: {
  objectKey: string;
  contentType: string;
  entityType: string;
  entityId?: string | null;
  uploadedBy: string;
  expiresAt: string;
}): Promise<{ id: string } | { error: string }> {
  const admin = createAdminClient();
  const bucket = await bucketName();

  const { data, error } = await admin
    .from("storage_uploads")
    .insert({
      object_key: params.objectKey,
      bucket,
      content_type: params.contentType,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      uploaded_by: params.uploadedBy,
      uploaded_via: "driver_presigned",
      status: "pending",
      expires_at: params.expiresAt,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "key_conflict" };
    return { error: "insert_failed" };
  }

  return { id: data.id };
}

export async function confirmPendingUpload(
  uploadId: string,
  authUid: string,
  sizeBytes: number,
): Promise<{ ok: true; objectKey: string } | { error: string }> {
  const admin = createAdminClient();

  const { data: row, error: fetchErr } = await admin
    .from("storage_uploads")
    .select("id, object_key, uploaded_by, status")
    .eq("id", uploadId)
    .maybeSingle();

  if (fetchErr || !row) return { error: "not_found" };
  if (row.uploaded_by !== authUid) return { error: "not_authorized" };
  if (row.status !== "pending") return { error: "invalid_status" };

  const { error: updateErr } = await admin
    .from("storage_uploads")
    .update({
      status: "completed",
      size_bytes: sizeBytes,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", uploadId);

  if (updateErr) return { error: "update_failed" };

  return { ok: true, objectKey: row.object_key };
}

export async function markExpiredPendingUploads(): Promise<{
  expired: number;
  deletedFromR2: number;
}> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: rows } = await admin
    .from("storage_uploads")
    .select("id, object_key")
    .eq("status", "pending")
    .lt("expires_at", now)
    .limit(200);

  if (!rows?.length) return { expired: 0, deletedFromR2: 0 };

  const ids = rows.map((r) => r.id);
  await admin
    .from("storage_uploads")
    .update({ status: "expired" })
    .in("id", ids);

  const r2 = await import("@/lib/storage/r2-client");
  let deletedFromR2 = 0;
  for (const row of rows) {
    try {
      const head = await r2.headObject(row.object_key);
      if (head.exists) {
        await r2.deleteObject(row.object_key);
        deletedFromR2 += 1;
      }
    } catch {
      /* best-effort */
    }
  }

  return { expired: rows.length, deletedFromR2 };
}
