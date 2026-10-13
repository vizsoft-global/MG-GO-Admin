import { NextResponse } from "next/server";
import { withCors } from "@/lib/http/cors";
import { COLLECTIONS } from "@/lib/firebase/db";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { isDriverOwnedAvatarKey } from "@/lib/storage/driver-avatar-key";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";
import { resolveOrderProofUrl } from "@/lib/storage/order-proof-resolve";
import { STORAGE_UPLOADS } from "@/lib/storage/storage-upload-audit";

const PROOF_FIELDS = ["order_proof_url", "pickup_proof_url", "cancel_proof_url"] as const;
const PROOF_LISTS = ["order_proof_urls", "pickup_proof_urls", "cancel_proof_urls"] as const;

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const auth = await requireDriverFromRequest(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const objectKey = searchParams.get("objectKey")?.trim();
  if (!objectKey) {
    return NextResponse.json({ error: "missing_object_key" }, { status: 400 });
  }

  const db = await getFirebaseFirestore();
  if (!db) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let ownsDeliveryProof = false;
  for (const field of PROOF_FIELDS) {
    const snap = await db.collection(COLLECTIONS.deliveries).where(field, "==", objectKey).limit(5).get();
    if (snap.docs.some((doc) => doc.get("driver_id") === auth.driverId)) {
      ownsDeliveryProof = true;
      break;
    }
  }

  if (!ownsDeliveryProof) {
    for (const field of PROOF_LISTS) {
      const snap = await db
        .collection(COLLECTIONS.deliveries)
        .where(field, "array-contains", objectKey)
        .limit(5)
        .get();
      if (snap.docs.some((doc) => doc.get("driver_id") === auth.driverId)) {
        ownsDeliveryProof = true;
        break;
      }
    }
  }

  if (!ownsDeliveryProof) {
    const uploads = await db
      .collection(STORAGE_UPLOADS)
      .where("object_key", "==", objectKey)
      .limit(5)
      .get();
    const ownsUpload = uploads.docs.some((doc) => doc.get("uploaded_by") === auth.authUid);
    const driver = await db.collection(COLLECTIONS.drivers).doc(auth.driverId).get();
    const ownsAvatar =
      driver.get("avatar_object_key") === objectKey ||
      isDriverOwnedAvatarKey(auth.driverId, objectKey);

    if (!ownsUpload && !ownsAvatar) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const resolved = await resolveOrderProofUrl(objectKey);
  if (!resolved) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    readUrl: resolved.url,
    contentType: resolved.contentType,
  });
}

export const GET = withCors(handler);
export const OPTIONS = withCors(handler);
