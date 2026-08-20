import { NextResponse } from "next/server";
import { withCors } from "@/lib/http/cors";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";
import { resolveOrderProofUrl } from "@/lib/storage/order-proof-url";

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

  const admin = createAdminClient();

  const { data: delivery } = await admin
    .from("deliveries")
    .select("id")
    .eq("driver_id", auth.driverId)
    .or(
      [
        `order_proof_url.eq.${objectKey}`,
        `pickup_proof_url.eq.${objectKey}`,
        `cancel_proof_url.eq.${objectKey}`,
      ].join(","),
    )
    .maybeSingle();

  let ownsDeliveryProof = Boolean(delivery);
  if (!ownsDeliveryProof) {
    const arrayChecks = await Promise.all(
      (["order_proof_urls", "pickup_proof_urls", "cancel_proof_urls"] as const).map(
        (column) =>
          admin
            .from("deliveries")
            .select("id")
            .eq("driver_id", auth.driverId)
            .contains(column, [objectKey])
            .limit(1)
            .maybeSingle(),
      ),
    );
    ownsDeliveryProof = arrayChecks.some((result) => Boolean(result.data));
  }

  if (!ownsDeliveryProof) {
    const { data: upload } = await admin
      .from("storage_uploads")
      .select("id")
      .eq("uploaded_by", auth.authUid)
      .eq("object_key", objectKey)
      .maybeSingle();

    const { data: driverRow } = await admin
      .from("drivers")
      .select("avatar_object_key")
      .eq("id", auth.driverId)
      .maybeSingle();

    const { isDriverOwnedAvatarKey } = await import("@/lib/storage/driver-avatar-key");
    const ownsAvatar =
      driverRow?.avatar_object_key === objectKey ||
      isDriverOwnedAvatarKey(auth.driverId, objectKey);

    if (!upload && !ownsAvatar) {
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
