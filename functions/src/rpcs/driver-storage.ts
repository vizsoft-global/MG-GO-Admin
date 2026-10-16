import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireRider, riderError } from "../core/rider";
import { presignR2Get, presignR2Put, r2ConfigFromEnv } from "../core/r2-esign";
import { pickText, type Dict } from "./_shared";

const STORAGE_BUCKETS = ["fuel-fills", "request-attachments", "esign-documents"] as const;
export const SIGNED_URL_EXPIRES_IN = 900;

type StorageBucket = (typeof STORAGE_BUCKETS)[number];

export const driverStorageDeps = {
  requireRider,
  getFirestore,
  getStorage,
};

function asData(request: CallableRequest<unknown>): Dict {
  return (request.data ?? {}) as Dict;
}

function parseBucket(value: string | null): StorageBucket {
  if (value && (STORAGE_BUCKETS as readonly string[]).includes(value)) {
    return value as StorageBucket;
  }
  throw riderError("invalid-argument", "invalid_bucket");
}

function hasTraversal(key: string): boolean {
  return key.includes("..") || key.startsWith("/") || key.includes("//");
}

export function objectKeyOwnedByRider(uid: string, key: string): boolean {
  return key.startsWith(`${uid}/`);
}

function requireObjectKey(value: string | null): string {
  if (!value) throw riderError("invalid-argument", "object_key_required");
  if (hasTraversal(value)) throw riderError("invalid-argument", "invalid_object_key");
  return value;
}

function storagePath(bucket: StorageBucket, objectKey: string): string {
  return `${bucket}/${objectKey}`;
}

/**
 * A GCS V4 signed URL, plus the reason when signing is not available (QA #28).
 *
 * The rider app saw a bare `upload_failed` for every fuel photo, which could not
 * be told apart from a dead bucket, a missing `iam.serviceAccounts.signBlob`
 * grant, or a rejected PUT. The stage is logged here and carried in the error
 * details so the next report names the cause instead of guessing at it.
 */
async function signObject(
  action: "read" | "write",
  path: string,
  contentType?: string,
): Promise<{ url: string; expires_in: number }> {
  let storage: ReturnType<typeof getStorage>;
  try {
    storage = driverStorageDeps.getStorage();
  } catch (error) {
    console.error("[driver-storage] getStorage failed:", error);
    throw riderError("failed-precondition", "storage_unavailable");
  }
  if (!storage) throw riderError("failed-precondition", "storage_unavailable");

  let bucket: ReturnType<typeof storage.bucket>;
  try {
    bucket = storage.bucket();
  } catch (error) {
    console.error("[driver-storage] storage.bucket() failed:", error);
    throw riderError("failed-precondition", "storage_unavailable");
  }
  if (!bucket) throw riderError("failed-precondition", "storage_unavailable");

  try {
    const expires = Date.now() + SIGNED_URL_EXPIRES_IN * 1000;
    const [url] = await bucket.file(path).getSignedUrl({
      version: "v4",
      action,
      expires,
      ...(action === "write" && contentType ? { contentType } : {}),
    });
    if (!url) throw new Error("empty_url");
    return { url, expires_in: SIGNED_URL_EXPIRES_IN };
  } catch (error) {
    console.error(`[driver-storage] getSignedUrl(${action}) failed for ${path}:`, error);
    throw riderError("failed-precondition", "storage_unavailable");
  }
}

async function riderOwnsForeignKey(uid: string, objectKey: string): Promise<boolean> {
  const db = driverStorageDeps.getFirestore();
  const [documentSnap, signedSnap, signatureSnap, attachmentSnap] = await Promise.all([
    db
      .collection(COLLECTIONS.esignRequests)
      .where("driver_id", "==", uid)
      .where("document_storage_key", "==", objectKey)
      .limit(1)
      .get(),
    db
      .collection(COLLECTIONS.esignRequests)
      .where("driver_id", "==", uid)
      .where("signed_document_storage_key", "==", objectKey)
      .limit(1)
      .get(),
    db
      .collection(COLLECTIONS.esignRequests)
      .where("driver_id", "==", uid)
      .where("signature_storage_key", "==", objectKey)
      .limit(1)
      .get(),
    db
      .collection(COLLECTIONS.requestAttachments)
      .where("storage_key", "==", objectKey)
      .limit(10)
      .get(),
  ]);

  if (!documentSnap.empty || !signedSnap.empty || !signatureSnap.empty) return true;

  for (const doc of attachmentSnap.docs) {
    const raw = (doc.data() ?? {}) as Dict;
    if (raw.uploaded_by === uid) return true;
    const requestId = typeof raw.request_id === "string" ? raw.request_id : null;
    if (!requestId) continue;
    const requestSnap = await db.collection(COLLECTIONS.requests).doc(requestId).get();
    if (requestSnap.exists && requestSnap.data()?.["driver_id"] === uid) return true;
  }
  return false;
}

export const driverGetUploadUrl = onCall(async (request) => {
  const ctx = await driverStorageDeps.requireRider(request);
  const data = asData(request);
  const bucket = parseBucket(pickText(data, "bucket", "p_bucket"));
  const objectKey = requireObjectKey(pickText(data, "object_key", "objectKey", "p_object_key"));
  const contentType = pickText(data, "content_type", "contentType", "p_content_type");
  if (!contentType) throw riderError("invalid-argument", "content_type_required");
  if (!objectKeyOwnedByRider(ctx.uid, objectKey)) {
    throw riderError("invalid-argument", "invalid_object_key");
  }

  // QA #28: rider storage lives in R2 — this project has no GCS bucket left, so
  // the old signed URL always failed. The app only needs a URL to PUT to, and an
  // R2 presigned PUT is exactly that shape, so no app change is required.
  const storagePathKey = storagePath(bucket, objectKey);
  if (r2ConfigFromEnv()) {
    try {
      const url = await presignR2Put(storagePathKey, contentType, SIGNED_URL_EXPIRES_IN);
      return {
        ok: true,
        url,
        object_key: objectKey,
        expires_in: SIGNED_URL_EXPIRES_IN,
        storage: "r2" as const,
      };
    } catch (error) {
      console.error("[driver-storage] r2 presign(write) failed:", error);
      throw riderError("failed-precondition", "storage_unavailable");
    }
  }

  const signed = await signObject("write", storagePathKey, contentType);
  return { ok: true, url: signed.url, object_key: objectKey, expires_in: signed.expires_in };
});

export const driverGetDownloadUrl = onCall(async (request) => {
  const ctx = await driverStorageDeps.requireRider(request);
  const data = asData(request);
  const bucket = parseBucket(pickText(data, "bucket", "p_bucket"));
  const objectKey = requireObjectKey(pickText(data, "object_key", "objectKey", "p_object_key"));

  const owned =
    objectKeyOwnedByRider(ctx.uid, objectKey) || (await riderOwnsForeignKey(ctx.uid, objectKey));
  if (!owned) throw riderError("permission-denied", "not_authorized");

  const storagePathKey = storagePath(bucket, objectKey);
  if (r2ConfigFromEnv()) {
    try {
      const url = await presignR2Get(storagePathKey, SIGNED_URL_EXPIRES_IN);
      return { ok: true, url, expires_in: SIGNED_URL_EXPIRES_IN, storage: "r2" as const };
    } catch (error) {
      console.error("[driver-storage] r2 presign(read) failed:", error);
      throw riderError("failed-precondition", "storage_unavailable");
    }
  }

  const signed = await signObject("read", storagePathKey);
  return { ok: true, url: signed.url, expires_in: signed.expires_in };
});
