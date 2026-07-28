import { createClient } from "@/lib/supabase/server";
import {
  buildDriverDocumentKey,
  buildIntakeDocumentKey,
} from "@/lib/storage/r2-keys";
import { getPresignedGetUrl, headObject } from "@/lib/storage/r2-client";
import { listDocumentTracking } from "@/lib/storage/document-tracking";
import {
  DOCUMENT_TYPES,
  type DriverDocumentType,
  type DriverRemoteDocument,
} from "@/features/drivers/types";

const DOC_EXTS = ["pdf", "png", "jpg", "webp"] as const;
const SIGNED_URL_TTL = 900;

export type { DriverRemoteDocument };

function intakeKeysForType(
  intakeId: string,
  docType: DriverDocumentType,
): string[] {
  return DOC_EXTS.map((ext) => buildIntakeDocumentKey(intakeId, docType, ext));
}

function driverKeysForType(
  driverProfileId: string,
  docType: DriverDocumentType,
): string[] {
  return DOC_EXTS.map((ext) =>
    buildDriverDocumentKey(driverProfileId, docType, ext),
  );
}

/** All R2 keys to delete for one doc type (intake + linked driver paths). */
export function allDocumentKeysForType(
  intakeId: string,
  driverProfileId: string | null,
  docType: DriverDocumentType,
): string[] {
  const keys = intakeKeysForType(intakeId, docType);
  if (driverProfileId) {
    keys.push(...driverKeysForType(driverProfileId, docType));
  }
  return keys;
}

async function firstExistingKey(
  keys: string[],
): Promise<{ key: string; size?: number; contentType?: string } | null> {
  for (const key of keys) {
    const head = await headObject(key);
    if (head.exists) {
      return { key, size: head.size, contentType: head.contentType };
    }
  }
  return null;
}

async function remoteFromKey(
  key: string,
  source: "driver" | "intake",
  size?: number,
  contentType?: string,
): Promise<DriverRemoteDocument> {
  const signedUrl = await getPresignedGetUrl(key, SIGNED_URL_TTL);
  return {
    objectKey: key,
    signedUrl,
    sizeBytes: size ?? null,
    contentType: contentType ?? null,
    source,
  };
}

/**
 * Resolve uploaded documents for an intake (and optional linked driver profile).
 * Prefers `driver_documents` rows when linked; fills gaps from intake R2 prefix.
 */
export async function listExistingDriverDocuments(
  intakeId: string,
  driverProfileId: string | null,
): Promise<Partial<Record<DriverDocumentType, DriverRemoteDocument>>> {
  const out: Partial<Record<DriverDocumentType, DriverRemoteDocument>> = {};
  const supabase = await createClient();

  const fromDb = new Map<DriverDocumentType, string>();
  if (driverProfileId) {
    const { data: rows } = await supabase
      .from("driver_documents")
      .select("doc_type, file_url, updated_at")
      .eq("driver_id", driverProfileId)
      .order("updated_at", { ascending: false });

    for (const row of rows ?? []) {
      const docType = row.doc_type as DriverDocumentType;
      if (!DOCUMENT_TYPES.includes(docType)) continue;
      if (!fromDb.has(docType) && row.file_url?.trim()) {
        fromDb.set(docType, row.file_url.trim());
      }
    }
  }

  for (const docType of DOCUMENT_TYPES) {
    const dbKey = fromDb.get(docType);
    if (dbKey) {
      const head = await headObject(dbKey);
      if (head.exists) {
        out[docType] = await remoteFromKey(
          dbKey,
          "driver",
          head.size,
          head.contentType,
        );
        continue;
      }
    }

    const hit = await firstExistingKey(intakeKeysForType(intakeId, docType));
    if (hit) {
      out[docType] = await remoteFromKey(
        hit.key,
        "intake",
        hit.size,
        hit.contentType,
      );
    }
  }

  const tracking = await listDocumentTracking(intakeId, driverProfileId);
  for (const docType of DOCUMENT_TYPES) {
    const expiry = tracking[docType];
    if (expiry && out[docType]) {
      out[docType] = { ...out[docType]!, expiry };
    }
  }

  return out;
}
