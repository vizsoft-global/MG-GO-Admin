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
    .eq("order_proof_url", objectKey)
    .maybeSingle();

  if (!delivery) {
    const { data: upload } = await admin
      .from("storage_uploads")
      .select("id")
      .eq("uploaded_by", auth.authUid)
      .eq("object_key", objectKey)
      .maybeSingle();

    if (!upload) {
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
