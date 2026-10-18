import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import {
  buildDriverDocumentKey,
  buildIntakeDocumentKey,
} from "@/lib/storage/r2-keys";
import { getPresignedGetUrl, headObject } from "@/lib/storage/r2-client";
import { listDocumentTracking } from "@/lib/storage/document-tracking";
import {
  DOCUMENT_TYPES,
  type DriverDocumentType,
  type DriverExtraDocument,
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

function updatedMillis(value: unknown): number {
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

/**
 * Resolve uploaded documents for an intake (and optional linked driver profile).
 * Prefers `driver_documents` rows when linked; fills gaps from intake R2 prefix.
 */
export async function listExistingDriverDocuments(
  intakeId: string,
  driverProfileId: string | null,
): Promise<Partial<Record<DriverDocumentType, DriverRemoteDocument>>> {
  const out: Partial<Record<DriverDocumentType, DriverRemoteDocument>> = {};
  const fromDb = new Map<DriverDocumentType, string>();

  if (driverProfileId) {
    const db = await staffDb();
    if (db) {
      const snap = await db
        .collection(COLLECTIONS.driverDocuments)
        .where("driver_id", "==", driverProfileId)
        .get();
      const rows = [...snap.docs].sort(
        (a, b) => updatedMillis(b.get("updated_at")) - updatedMillis(a.get("updated_at")),
      );
      for (const row of rows) {
        const docType = row.get("doc_type") as DriverDocumentType;
        if (!DOCUMENT_TYPES.includes(docType)) continue;
        const fileUrl = typeof row.get("file_url") === "string" ? row.get("file_url").trim() : "";
        if (!fromDb.has(docType) && fileUrl) fromDb.set(docType, fileUrl);
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

function isoFromValue(value: unknown): string | null {
  const millis = updatedMillis(value);
  return millis > 0 ? new Date(millis).toISOString() : null;
}

/**
 * Admin-named attachments. Unlike the six compliance slots these accumulate:
 * every upload keeps its own title and key.
 */
export async function listExtraDriverDocuments(
  intakeId: string,
  driverProfileId: string | null,
): Promise<DriverExtraDocument[]> {
  const db = await staffDb();
  if (!db) return [];

  const collection = db.collection(COLLECTIONS.driverExtraDocuments);
  const [byIntake, byDriver] = await Promise.all([
    collection.where("intake_id", "==", intakeId).get(),
    driverProfileId
      ? collection.where("driver_id", "==", driverProfileId).get()
      : Promise.resolve(null),
  ]);

  const deduped = new Map<string, (typeof byIntake.docs)[number]>();
  for (const row of byIntake.docs) deduped.set(row.id, row);
  for (const row of byDriver?.docs ?? []) {
    if (!deduped.has(row.id)) deduped.set(row.id, row);
  }

  const sorted = [...deduped.values()].sort(
    (a, b) => updatedMillis(b.get("created_at") ?? b.get("updated_at")) -
      updatedMillis(a.get("created_at") ?? a.get("updated_at")),
  );

  const out: DriverExtraDocument[] = [];
  for (const row of sorted) {
    const objectKey = typeof row.get("file_url") === "string" ? row.get("file_url").trim() : "";
    if (!objectKey) continue;
    const head = await headObject(objectKey);
    if (!head.exists) continue;
    out.push({
      id: row.id,
      title:
        (typeof row.get("title") === "string" && row.get("title").trim()) ||
        objectKey.split("/").pop() ||
        objectKey,
      objectKey,
      signedUrl: await getPresignedGetUrl(objectKey, SIGNED_URL_TTL),
      sizeBytes: head.size ?? null,
      contentType: head.contentType ?? null,
      source: row.get("driver_id") ? "driver" : "intake",
      uploadedAt: isoFromValue(row.get("created_at") ?? row.get("updated_at")),
    });
  }
  return out;
}
