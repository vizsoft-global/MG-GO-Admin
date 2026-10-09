import { NextResponse } from "next/server";
import { withCors } from "@/lib/http/cors";
import { COLLECTIONS } from "@/lib/firebase/db";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";
import {
  contentTypeFromNotificationObjectKey,
  parseNotificationMedia,
  pickNotificationMediaByRole,
  type NotificationMediaRole,
} from "@/features/notifications/notification-media";
import { resolveNotificationMediaReadUrl } from "@/features/notifications/notification-media-storage";

const DISPATCH_SCAN = 1000;

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const auth = await requireDriverFromRequest(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get("campaignId")?.trim();
  const role = searchParams.get("role")?.trim() as NotificationMediaRole | undefined;

  if (!campaignId || (role !== "banner" && role !== "image")) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const db = await getFirebaseFirestore();
  if (!db) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const dispatch = await db
    .collection(COLLECTIONS.notificationDispatchItems)
    .where("driver_id", "==", auth.driverId)
    .limit(DISPATCH_SCAN)
    .get();
  const ownsCampaign = dispatch.docs.some((doc) => doc.get("campaign_id") === campaignId);
  if (!ownsCampaign) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const campaign = await db.collection(COLLECTIONS.notificationCampaigns).doc(campaignId).get();
  if (!campaign.exists) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const mediaItem = pickNotificationMediaByRole(parseNotificationMedia(campaign.get("media")), role);
  if (!mediaItem) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const readUrl = await resolveNotificationMediaReadUrl(mediaItem.object_key, 3600);
  if (!readUrl) {
    return NextResponse.json({ error: "sign_failed" }, { status: 500 });
  }

  return NextResponse.json({
    role: mediaItem.role,
    objectKey: mediaItem.object_key,
    readUrl,
    contentType: contentTypeFromNotificationObjectKey(mediaItem.object_key),
  });
}

export const GET = withCors(handler);
export const OPTIONS = withCors(handler);
