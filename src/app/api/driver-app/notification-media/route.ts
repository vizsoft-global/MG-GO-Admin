import { NextResponse } from "next/server";
import { withCors } from "@/lib/http/cors";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";
import {
  contentTypeFromNotificationObjectKey,
  parseNotificationMedia,
  pickNotificationMediaByRole,
  resolveNotificationMediaReadUrl,
  type NotificationMediaRole,
} from "@/features/notifications/notification-media";

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

  const admin = createAdminClient();
  const { data: dispatchItem } = await admin
    .from("notification_dispatch_items")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("driver_id", auth.driverId)
    .maybeSingle();

  if (!dispatchItem) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: campaign } = await admin
    .from("notification_campaigns")
    .select("media")
    .eq("id", campaignId)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const mediaItem = pickNotificationMediaByRole(parseNotificationMedia(campaign.media), role);
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
