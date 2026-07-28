import { NextResponse } from "next/server";
import { withCors } from "@/lib/http/cors";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";
import { getPresignedGetUrl } from "@/lib/storage/r2-client";

async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const auth = await requireDriverFromRequest(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    50,
    Math.max(1, Number(searchParams.get("limit") ?? 50)),
  );

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("storage_uploads")
    .select(
      "id, object_key, size_bytes, content_type, entity_type, entity_id, uploaded_via, uploaded_at",
    )
    .eq("uploaded_by", auth.authUid)
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  const uploads = await Promise.all(
    (data ?? []).map(async (row) => {
      let readUrl: string | null = null;
      try {
        readUrl = await getPresignedGetUrl(row.object_key);
      } catch {
        readUrl = null;
      }
      return {
        id: row.id,
        objectKey: row.object_key,
        sizeBytes: row.size_bytes,
        contentType: row.content_type,
        entityType: row.entity_type,
        entityId: row.entity_id,
        uploadedVia: row.uploaded_via,
        uploadedAt: row.uploaded_at,
        readUrl,
      };
    }),
  );

  return NextResponse.json({ uploads });
}

export const GET = withCors(handler);
export const OPTIONS = withCors(handler);
