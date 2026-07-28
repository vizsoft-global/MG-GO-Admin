import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createAdminClient } from "@/lib/supabase/admin";
import { getR2BucketName, getR2Client } from "@/lib/storage/r2-client";

const MAX_PAGES = 20;

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

export async function getRecentUploads(
  limit = 25,
  filter?: "all" | "admin" | "driver",
): Promise<RecentUploadRow[]> {
  const admin = createAdminClient();

  let query = admin
    .from("storage_uploads")
    .select(
      "id, object_key, size_bytes, content_type, entity_type, entity_id, uploaded_via, status, uploaded_by, uploaded_at",
    )
    .eq("status", "completed")
    .order("uploaded_at", { ascending: false })
    .limit(limit);

  if (filter === "admin") {
    query = query.eq("uploaded_via", "admin");
  } else if (filter === "driver") {
    query = query.in("uploaded_via", ["driver_presigned", "driver_proxy"]);
  }

  const { data, error } = await query;
  if (error || !data?.length) return [];

  const userIds = [
    ...new Set(data.map((r) => r.uploaded_by).filter(Boolean)),
  ] as string[];

  const profileMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds);

    for (const p of profiles ?? []) {
      profileMap.set(
        p.id,
        p.full_name?.trim() || p.email?.trim() || p.id.slice(0, 8),
      );
    }
  }

  return data.map((row) => ({
    id: row.id,
    objectKey: row.object_key,
    sizeBytes: row.size_bytes,
    contentType: row.content_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    uploadedVia: row.uploaded_via,
    status: row.status,
    uploaderLabel: row.uploaded_by
      ? (profileMap.get(row.uploaded_by) ?? row.uploaded_by.slice(0, 8))
      : null,
    uploadedAt: row.uploaded_at,
  }));
}
