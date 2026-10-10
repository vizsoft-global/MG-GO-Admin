import { onCall, type CallableRequest } from "firebase-functions/v2/https";
import { getStorage } from "firebase-admin/storage";
import { getFirestore } from "../core/fs";
import { COLLECTIONS } from "../core/collections";
import { requireRider, riderError } from "../core/rider";
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

async function signObject(
  action: "read" | "write",
  path: string,
  contentType?: string,
): Promise<{ url: string; expires_in: number }> {
  let storage: ReturnType<typeof getStorage>;
  try {
    storage = driverStorageDeps.getStorage();
  } catch {
    throw riderError("failed-precondition", "storage_unavailable");
  }
  if (!storage) throw riderError("failed-precondition", "storage_unavailable");

  let bucket: ReturnType<typeof storage.bucket>;
  try {
    bucket = storage.bucket();
  } catch {
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
  } catch {
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

  const signed = await signObject("write", storagePath(bucket, objectKey), contentType);
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

  const signed = await signObject("read", storagePath(bucket, objectKey));
  return { ok: true, url: signed.url, expires_in: signed.expires_in };
});
