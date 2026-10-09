import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { resolveR2Config } from "@/lib/storage/r2-config";
import { syncDriverAvatarKey } from "@/lib/storage/sync-driver-avatar";

export const STORAGE_UPLOADS = "storage_uploads";

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

function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function millis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? NaN : parsed;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date ? date.getTime() : NaN;
  }
  return NaN;
}

async function uploads(db: Firestore) {
  return db.collection(STORAGE_UPLOADS);
}

export async function recordStorageUpload(params: RecordUploadParams): Promise<void> {
  try {
    const db = await getFirebaseFirestore();
    if (!db) return;
    const bucket = await bucketName();
    const now = new Date();
    const status = params.status ?? "completed";
    const col = await uploads(db);
    const existing = await col.where("object_key", "==", params.objectKey).limit(1).get();
    const ref = existing.empty ? col.doc() : existing.docs[0]!.ref;
    await ref.set(
      {
        id: ref.id,
        object_key: params.objectKey,
        bucket,
        size_bytes: params.sizeBytes,
        content_type: params.contentType ?? null,
        entity_type: params.entityType ?? null,
        entity_id: params.entityId ?? null,
        uploaded_by: params.uploadedBy ?? null,
        uploaded_via: params.uploadedVia,
        status,
        expires_at: asDate(params.expiresAt),
        confirmed_at: asDate(params.confirmedAt) ?? (status === "completed" ? now : null),
        uploaded_at: now,
      },
      { merge: true },
    );
  } catch (error) {
    console.error("[storage_uploads] audit insert failed", error);
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
  const db = await getFirebaseFirestore();
  if (!db) return { error: "insert_failed" };
  const bucket = await bucketName();
  const col = await uploads(db);
  const ref = col.doc();

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(col.where("object_key", "==", params.objectKey).limit(1));
      if (!existing.empty) {
        throw new Error("key_conflict");
      }
      tx.set(ref, {
        id: ref.id,
        object_key: params.objectKey,
        bucket,
        content_type: params.contentType,
        entity_type: params.entityType,
        entity_id: params.entityId ?? null,
        uploaded_by: params.uploadedBy,
        uploaded_via: "driver_presigned",
        status: "pending",
        expires_at: asDate(params.expiresAt) ?? params.expiresAt,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "key_conflict") {
      return { error: "key_conflict" };
    }
    return { error: "insert_failed" };
  }

  return { id: ref.id };
}

export async function confirmPendingUpload(
  uploadId: string,
  authUid: string,
  sizeBytes: number,
): Promise<{ ok: true; objectKey: string } | { error: string }> {
  const db = await getFirebaseFirestore();
  if (!db) return { error: "update_failed" };

  const ref = db.collection(STORAGE_UPLOADS).doc(uploadId);
  const snap = await ref.get();
  if (!snap.exists) return { error: "not_found" };

  const row = snap.data() ?? {};
  const objectKey = typeof row.object_key === "string" ? row.object_key : "";
  if (row.uploaded_by !== authUid) return { error: "not_authorized" };
  if (row.status !== "pending") return { error: "invalid_status" };

  try {
    await ref.update({
      status: "completed",
      size_bytes: sizeBytes,
      confirmed_at: new Date(),
    });
  } catch {
    return { error: "update_failed" };
  }

  if (row.entity_type === "driver_avatar") {
    await syncDriverAvatarKey(authUid, objectKey);
  }

  return { ok: true, objectKey };
}

export async function markExpiredPendingUploads(): Promise<{
  expired: number;
  deletedFromR2: number;
}> {
  const db = await getFirebaseFirestore();
  if (!db) return { expired: 0, deletedFromR2: 0 };

  const now = Date.now();
  const snap = await db.collection(STORAGE_UPLOADS).where("status", "==", "pending").limit(500).get();
  const rows = snap.docs
    .filter((doc) => {
      const expires = millis(doc.get("expires_at"));
      return Number.isFinite(expires) && expires < now;
    })
    .slice(0, 200);

  if (rows.length === 0) return { expired: 0, deletedFromR2: 0 };

  for (let index = 0; index < rows.length; index += 400) {
    const batch = db.batch();
    for (const doc of rows.slice(index, index + 400)) {
      batch.update(doc.ref, { status: "expired" });
    }
    await batch.commit();
  }

  // r2-client imports recordStorageUpload from this file, so a static import cycles.
  const r2 = await import("@/lib/storage/r2-client");
  let deletedFromR2 = 0;
  for (const row of rows) {
    const objectKey = row.get("object_key");
    if (typeof objectKey !== "string" || !objectKey) continue;
    try {
      const head = await r2.headObject(objectKey);
      if (head.exists) {
        await r2.deleteObject(objectKey);
        deletedFromR2 += 1;
      }
    } catch {
      /* best-effort */
    }
  }

  return { expired: rows.length, deletedFromR2 };
}
