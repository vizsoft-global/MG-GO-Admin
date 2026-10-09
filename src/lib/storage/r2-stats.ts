import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { COLLECTIONS } from "@/lib/firebase/db";
import { getFirebaseFirestore } from "@/lib/firebase/admin";
import { getR2BucketName, getR2Client } from "@/lib/storage/r2-client";
import { STORAGE_UPLOADS } from "@/lib/storage/storage-upload-audit";

const MAX_PAGES = 20;
const RECENT_SCAN = 400;

export type ExtensionBreakdown = {
  ext: string;
  count: number;
  bytes: number;
};

export type PrefixBreakdown = {
  prefix: string;
  count: number;
  bytes: number;
};

export type BucketStats = {
  totalCount: number;
  totalBytes: number;
  byExtension: ExtensionBreakdown[];
  byPrefix: PrefixBreakdown[];
};

function extensionFromKey(key: string): string {
  const name = key.split("/").pop() ?? key;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "(none)";
  return name.slice(dot + 1).toLowerCase() || "(none)";
}

function prefixFromKey(key: string): string {
  const slash = key.indexOf("/");
  if (slash <= 0) return "(root)";
  return `${key.slice(0, slash + 1)}`;
}

function sortBreakdown<T extends { count: number; bytes: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.bytes - a.bytes || b.count - a.count);
}

export async function getBucketStats(): Promise<BucketStats> {
  const s3 = await getR2Client();
  const bucket = await getR2BucketName();

  const extMap = new Map<string, { count: number; bytes: number }>();
  const prefixMap = new Map<string, { count: number; bytes: number }>();
  let totalCount = 0;
  let totalBytes = 0;
  let continuationToken: string | undefined;
  let pages = 0;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      const size = obj.Size ?? 0;
      totalCount += 1;
      totalBytes += size;

      const ext = extensionFromKey(obj.Key);
      const extRow = extMap.get(ext) ?? { count: 0, bytes: 0 };
      extRow.count += 1;
      extRow.bytes += size;
      extMap.set(ext, extRow);

      const prefix = prefixFromKey(obj.Key);
      const prefixRow = prefixMap.get(prefix) ?? { count: 0, bytes: 0 };
      prefixRow.count += 1;
      prefixRow.bytes += size;
      prefixMap.set(prefix, prefixRow);
    }

    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    pages += 1;
  } while (continuationToken && pages < MAX_PAGES);

  return {
    totalCount,
    totalBytes,
    byExtension: sortBreakdown(
      [...extMap.entries()].map(([ext, v]) => ({ ext, ...v })),
    ),
    byPrefix: sortBreakdown(
      [...prefixMap.entries()].map(([prefix, v]) => ({ prefix, ...v })),
    ),
  };
}

export type RecentUploadRow = {
  id: string;
  objectKey: string;
  sizeBytes: number | null;
  contentType: string | null;
  entityType: string | null;
  entityId: string | null;
  uploadedVia: string;
  status: string;
  uploaderLabel: string | null;
  uploadedAt: string;
};

type ViaFilter = "all" | "admin" | "driver";

function viaMatches(via: string, filter: ViaFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "admin":
      return via === "admin";
    case "driver":
      return via === "driver_presigned" || via === "driver_proxy";
    default: {
      const unreachable: never = filter;
      return unreachable;
    }
  }
}

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

function iso(value: unknown): string {
  const at = millis(value);
  return at > 0 ? new Date(at).toISOString() : "";
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function getRecentUploads(
  limit = 25,
  filter?: ViaFilter,
): Promise<RecentUploadRow[]> {
  const db = await getFirebaseFirestore();
  if (!db) return [];

  try {
    const snap = await db
      .collection(STORAGE_UPLOADS)
      .orderBy("uploaded_at", "desc")
      .limit(RECENT_SCAN)
      .get();
    const via = filter ?? "all";
    const rows = snap.docs
      .filter((doc) => doc.get("status") === "completed" && viaMatches(String(doc.get("uploaded_via") ?? ""), via))
      .slice(0, limit);
    if (rows.length === 0) return [];

    const userIds = [
      ...new Set(
        rows
          .map((row) => row.get("uploaded_by"))
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    const profileMap = new Map<string, string>();
    for (let index = 0; index < userIds.length; index += 30) {
      const refs = userIds
        .slice(index, index + 30)
        .map((id) => db.collection(COLLECTIONS.profiles).doc(id));
      const profiles = await db.getAll(...refs);
      for (const profile of profiles) {
        if (!profile.exists) continue;
        const data = profile.data() ?? {};
        const fullName = typeof data.full_name === "string" ? data.full_name.trim() : "";
        const email = typeof data.email === "string" ? data.email.trim() : "";
        profileMap.set(profile.id, fullName || email || profile.id.slice(0, 8));
      }
    }

    return rows.map((row) => {
      const uploadedBy = text(row.get("uploaded_by"));
      return {
        id: typeof row.get("id") === "string" ? row.get("id") : row.id,
        objectKey: String(row.get("object_key") ?? ""),
        sizeBytes: typeof row.get("size_bytes") === "number" ? row.get("size_bytes") : null,
        contentType: text(row.get("content_type")),
        entityType: text(row.get("entity_type")),
        entityId: text(row.get("entity_id")),
        uploadedVia: String(row.get("uploaded_via") ?? ""),
        status: String(row.get("status") ?? ""),
        uploaderLabel: uploadedBy
          ? (profileMap.get(uploadedBy) ?? uploadedBy.slice(0, 8))
          : null,
        uploadedAt: iso(row.get("uploaded_at")),
      };
    });
  } catch {
    return [];
  }
}
