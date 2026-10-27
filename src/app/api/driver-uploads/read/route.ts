import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { withCors } from "@/lib/http/cors";
import { readEsignObject } from "@/features/esign/esign-r2";
import {
  ESIGN_STORAGE_KEY_FIELDS,
  esignStorageKeyCandidates,
} from "@/features/esign/esign-rider-access";
import { esignObjectPath } from "@/features/esign/esign-storage-key";
import { COLLECTIONS } from "@/lib/firebase/db";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { isDriverOwnedAvatarKey } from "@/lib/storage/driver-avatar-key";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";
import { guessContentTypeFromKey } from "@/lib/storage/order-proof-url";
import { resolveOrderProofUrl } from "@/lib/storage/order-proof-resolve";
import {
  esignR2WorkerConfig,
  signEsignReadGrant,
  verifyEsignReadGrant,
} from "@/lib/storage/esign-r2-worker";
import { getPresignedGetUrl } from "@/lib/storage/r2-client";
import { isR2Configured } from "@/lib/storage/r2-config";
import { STORAGE_UPLOADS } from "@/lib/storage/storage-upload-audit";

const PROOF_FIELDS = ["order_proof_url", "pickup_proof_url", "cancel_proof_url"] as const;
const PROOF_LISTS = ["order_proof_urls", "pickup_proof_urls", "cancel_proof_urls"] as const;
const ESIGN_READ_TTL_MS = 900_000;

async function streamEsignObject(objectKey: string): Promise<Response> {
  const object = await readEsignObject(objectKey);
  if (!object) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return new Response(Buffer.from(object.bytes), {
    headers: {
      "content-type":
        object.contentType ?? guessContentTypeFromKey(objectKey) ?? "application/octet-stream",
      "cache-control": "private, max-age=60",
    },
  });
}

async function esignReadJson(request: Request, objectKey: string): Promise<Response> {
  if (await isR2Configured()) {
    try {
      const url = await getPresignedGetUrl(esignObjectPath(objectKey), 900);
      return NextResponse.json({
        readUrl: url,
        contentType: guessContentTypeFromKey(objectKey),
      });
    } catch {
      // Worker stream below
    }
  }
  const worker = esignR2WorkerConfig();
  if (!worker) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const exp = Date.now() + ESIGN_READ_TTL_MS;
  const sig = signEsignReadGrant({ key: objectKey, exp, secret: worker.secret });
  const next = new URL(request.url);
  next.search = "";
  next.searchParams.set("objectKey", objectKey);
  next.searchParams.set("stream", "1");
  next.searchParams.set("exp", String(exp));
  next.searchParams.set("sig", sig);
  return NextResponse.json({
    readUrl: next.toString(),
    contentType: guessContentTypeFromKey(objectKey),
  });
}

async function riderOwnsEsignObject(
  db: Firestore,
  driverId: string,
  objectKey: string,
): Promise<boolean> {
  const candidates = esignStorageKeyCandidates(objectKey);
  if (candidates.length === 0) return false;
  for (const field of ESIGN_STORAGE_KEY_FIELDS) {
    for (const candidate of candidates) {
      const snap = await db
        .collection(COLLECTIONS.esignRequests)
        .where(field, "==", candidate)
        .limit(5)
        .get();
      if (snap.docs.some((doc) => doc.get("driver_id") === driverId)) {
        return true;
      }
    }
  }
  for (const candidate of candidates) {
    const snap = await db
      .collection(COLLECTIONS.esignRequestAttachments)
      .where("storage_key", "==", candidate)
      .limit(1)
      .get();
    const attachment = snap.docs[0];
    if (!attachment) continue;
    const requestId = attachment.get("request_id");
    if (typeof requestId !== "string" || requestId.length === 0) continue;
    const requestSnap = await db.collection(COLLECTIONS.esignRequests).doc(requestId).get();
    if (requestSnap.get("driver_id") === driverId) return true;
  }
  return false;
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const { searchParams } = new URL(request.url);
  if (searchParams.get("stream") === "1") {
    const streamKey = searchParams.get("objectKey")?.trim();
    const worker = esignR2WorkerConfig();
    if (!streamKey || !worker) {
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    const granted = verifyEsignReadGrant({
      key: streamKey,
      exp: Number(searchParams.get("exp")),
      sig: searchParams.get("sig") ?? "",
      secret: worker.secret,
    });
    if (!granted) {
      return NextResponse.json({ error: "not_authorized" }, { status: 401 });
    }
    return streamEsignObject(streamKey);
  }

  const auth = await requireDriverFromRequest(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

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
      const ownsEsign = await riderOwnsEsignObject(db, auth.driverId, objectKey);
      if (!ownsEsign) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return esignReadJson(request, objectKey);
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
