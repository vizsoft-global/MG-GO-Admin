import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { contentDispositionAttachment } from "@/lib/storage/order-proof-url";
import { guessProofContentType } from "@/lib/storage/proof-image-url";
import {
  ESIGN_BUCKET,
  type EsignDocumentKind,
  normalizeEsignStorageKey,
} from "@/features/esign/esign-storage-key";

function parseKind(raw: string | null): EsignDocumentKind | null {
  if (raw === "document" || raw === "signature" || raw === "signed") return raw;
  return null;
}

const KEY_COLUMN: Record<EsignDocumentKind, string> = {
  document: "document_storage_key",
  signature: "signature_storage_key",
  signed: "signed_document_storage_key",
};

function filenameFromKey(key: string, fallback: string): string {
  const part = key.split("/").pop()?.trim();
  return part && part.length > 0 ? part : fallback;
}

function contentDisposition(
  filename: string,
  disposition: "inline" | "attachment",
): string {
  if (disposition === "attachment") return contentDispositionAttachment(filename);
  const safe = filename.replace(/[\r\n"]/g, "_");
  return `inline; filename="${safe}"`;
}

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "requests.manage", session.isSuperAdmin)
  ) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id")?.trim() ?? "";
  const kind = parseKind(params.get("kind")?.trim() ?? null);
  const disposition = params.get("disposition") === "inline" ? "inline" : "attachment";

  if (!id || !kind) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("esign_requests")
    .select("document_storage_key, signature_storage_key, signed_document_storage_key")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rawKey = (data as Record<string, unknown>)[KEY_COLUMN[kind]];
  if (rawKey == null || String(rawKey).trim() === "") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const key = normalizeEsignStorageKey(String(rawKey));
  const admin = createAdminClient();
  const downloaded = await admin.storage.from(ESIGN_BUCKET).download(key);
  if (downloaded.error || !downloaded.data) {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }

  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  const filename = filenameFromKey(key, `${kind}.bin`);
  const contentType = downloaded.data.type || guessProofContentType(key) || "application/octet-stream";

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition(filename, disposition),
      "Cache-Control": "private, no-store",
    },
  });
}
