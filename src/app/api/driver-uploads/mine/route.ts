import { NextResponse } from "next/server";
import { withCors } from "@/lib/http/cors";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { requireDriverFromRequest } from "@/lib/storage/driver-upload-auth";
import { getPresignedGetUrl } from "@/lib/storage/r2-client";
import { STORAGE_UPLOADS } from "@/lib/storage/storage-upload-audit";

const MINE_SCAN = 200;

function millis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
  }
  return 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

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

  const db = await getFirebaseFirestore();
  if (!db) {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }

  try {
    const snap = await db
      .collection(STORAGE_UPLOADS)
      .where("uploaded_by", "==", auth.authUid)
      .limit(MINE_SCAN)
      .get();
    const rows = snap.docs
      .filter((doc) => doc.get("status") === "completed")
      .sort((a, b) => millis(b.get("uploaded_at")) - millis(a.get("uploaded_at")))
      .slice(0, Number.isFinite(limit) ? limit : 50);

    const uploads = await Promise.all(
      rows.map(async (row) => {
        const objectKey = String(row.get("object_key") ?? "");
        let readUrl: string | null = null;
        try {
          readUrl = await getPresignedGetUrl(objectKey);
        } catch {
          readUrl = null;
        }
        const uploadedAt = millis(row.get("uploaded_at"));
        return {
          id: typeof row.get("id") === "string" ? row.get("id") : row.id,
          objectKey,
          sizeBytes: typeof row.get("size_bytes") === "number" ? row.get("size_bytes") : null,
          contentType: text(row.get("content_type")),
          entityType: text(row.get("entity_type")),
          entityId: text(row.get("entity_id")),
          uploadedVia: text(row.get("uploaded_via")),
          uploadedAt: uploadedAt > 0 ? new Date(uploadedAt).toISOString() : null,
          readUrl,
        };
      }),
    );

    return NextResponse.json({ uploads });
  } catch {
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}

export const GET = withCors(handler);
export const OPTIONS = withCors(handler);
