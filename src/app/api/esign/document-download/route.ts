import { NextResponse } from "next/server";
import type { DocumentData } from "firebase-admin/firestore";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { contentDispositionAttachment } from "@/lib/storage/order-proof-url";
import { guessProofContentType } from "@/lib/storage/proof-image-url";
import { readEsignObject } from "@/features/esign/esign-r2";
import {
  type EsignDownloadKind,
  normalizeEsignStorageKey,
} from "@/features/esign/esign-storage-key";

function parseKind(raw: string | null): EsignDownloadKind | null {
  if (raw === "document" || raw === "signature" || raw === "signed" || raw === "attachment") {
    return raw;
  }
  return null;
}

const KEY_COLUMN: Record<"document" | "signature" | "signed", string> = {
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

function cell(value: unknown): unknown {
  if (value == null) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return value;
}

function docFields(data: DocumentData | undefined): Record<string, unknown> | null {
  if (!data) return null;
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) row[key] = cell(value);
  return row;
}

async function downloadEsignObject(
  key: string,
): Promise<{ bytes: Buffer; contentType: string } | { error: string }> {
  const object = await readEsignObject(key);
  if (!object) return { error: "read_failed" };
  return {
    bytes: Buffer.from(object.bytes),
    contentType: object.contentType ?? "",
  };
}

export async function GET(request: Request) {
  const session = await getSessionUser();
  const canManage =
    Boolean(session) &&
    (hasPermissionInSet(session!.permissions, "requests.manage", session!.isSuperAdmin) ||
      hasPermissionInSet(session!.permissions, "employeedesk.manage", session!.isSuperAdmin));
  const canSign =
    canManage ||
    (Boolean(session) &&
      hasPermissionInSet(session!.permissions, "esign.sign", session!.isSuperAdmin));
  if (!session || !canSign) {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id")?.trim() ?? "";
  const kind = parseKind(params.get("kind")?.trim() ?? null);
  const disposition = params.get("disposition") === "inline" ? "inline" : "attachment";

  if (!id || !kind) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const db = await staffDb();
  if (!db) return NextResponse.json({ error: "read_failed" }, { status: 500 });

  if (kind === "attachment") {
    let attachment: Record<string, unknown> | null = null;
    try {
      const snap = await db.collection(COLLECTIONS.esignRequestAttachments).doc(id).get();
      attachment = snap.exists ? docFields(snap.data()) : null;
    } catch {
      return NextResponse.json({ error: "read_failed" }, { status: 500 });
    }
    if (!attachment) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const requestId = String(attachment.request_id ?? "").trim();
    if (!requestId) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (!canManage) {
      try {
        const assigned = await db
          .collection(COLLECTIONS.esignRequestSigners)
          .where("request_id", "==", requestId)
          .where("staff_user_id", "==", session.id)
          .limit(1)
          .get();
        if (assigned.empty) {
          return NextResponse.json({ error: "not_authorized" }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: "not_authorized" }, { status: 403 });
      }
    }

    const rawAttachmentKey = attachment.storage_key;
    if (rawAttachmentKey == null || String(rawAttachmentKey).trim() === "") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const key = normalizeEsignStorageKey(String(rawAttachmentKey));
    const downloaded = await downloadEsignObject(key);
    if ("error" in downloaded) {
      return NextResponse.json({ error: "read_failed" }, { status: 500 });
    }
    const filename =
      String(attachment.name ?? "").trim() || filenameFromKey(key, "attachment.bin");
    const contentType =
      String(attachment.content_type ?? "").trim() ||
      downloaded.contentType ||
      guessProofContentType(key) ||
      "application/octet-stream";
    return new NextResponse(new Uint8Array(downloaded.bytes), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition(filename, disposition),
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (!canManage) {
    try {
      const assigned = await db
        .collection(COLLECTIONS.esignRequestSigners)
        .where("request_id", "==", id)
        .where("staff_user_id", "==", session.id)
        .limit(1)
        .get();
      if (assigned.empty) {
        return NextResponse.json({ error: "not_authorized" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "not_authorized" }, { status: 403 });
    }
  }

  let data: Record<string, unknown> | null = null;
  try {
    const snap = await db.collection(COLLECTIONS.esignRequests).doc(id).get();
    data = snap.exists ? docFields(snap.data()) : null;
  } catch {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rawKey = data[KEY_COLUMN[kind]];
  if (rawKey == null || String(rawKey).trim() === "") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const key = normalizeEsignStorageKey(String(rawKey));
  const downloaded = await downloadEsignObject(key);
  if ("error" in downloaded) {
    return NextResponse.json({ error: "read_failed" }, { status: 500 });
  }

  const filename = filenameFromKey(key, `${kind}.bin`);
  const contentType = downloaded.contentType || guessProofContentType(key) || "application/octet-stream";

  return new NextResponse(new Uint8Array(downloaded.bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition(filename, disposition),
      "Cache-Control": "private, no-store",
    },
  });
}
