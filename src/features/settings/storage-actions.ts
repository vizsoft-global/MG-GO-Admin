"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { getR2Analytics } from "@/lib/storage/cf-analytics";
import { invalidateR2ConfigCache, maskSecret, resolveR2Config } from "@/lib/storage/r2-config";
import { runR2StorageProbe } from "@/lib/storage/r2-client";
import { getBucketStats, getRecentUploads } from "@/lib/storage/r2-stats";
import type { RecentUploadRow } from "@/lib/storage/r2-stats";
import type { BucketStats } from "@/lib/storage/r2-stats";
import type { R2AnalyticsResult } from "@/lib/storage/cf-analytics";

async function requireSuperAdmin() {
  const session = await getSessionUser();
  if (!session?.isSuperAdmin) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export type StorageOverview = {
  connection: {
    configured: boolean;
    bucket: string;
    accountIdMasked: string;
    endpoint: string;
  };
  stats: BucketStats | null;
  analytics: R2AnalyticsResult;
  recentUploads: RecentUploadRow[];
  statsError?: string;
};

export async function getStorageOverview(
  uploadFilter: "all" | "admin" | "driver" = "all",
): Promise<StorageOverview | { error: string }> {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth;

  let connection: StorageOverview["connection"] = {
    configured: false,
    bucket: "",
    accountIdMasked: "",
    endpoint: "",
  };

  let analytics: R2AnalyticsResult = {
    available: false,
    reason: "not_configured",
  };

  try {
    const config = await resolveR2Config();
    connection = {
      configured: true,
      bucket: config.bucketName,
      accountIdMasked: maskSecret(config.accountId),
      endpoint: config.endpoint,
    };
    analytics = await getR2Analytics({
      accountId: config.accountId,
      days: 30,
    });
  } catch {
    return {
      connection,
      stats: null,
      analytics,
      recentUploads: [],
      statsError: "not_configured",
    };
  }

  let stats: BucketStats | null = null;
  let statsError: string | undefined;

  try {
    stats = await getBucketStats();
  } catch (e) {
    statsError = e instanceof Error ? e.message : "list_failed";
  }

  const recentUploads = await getRecentUploads(25, uploadFilter);

  return {
    connection,
    stats,
    analytics,
    recentUploads,
    statsError,
  };
}

export async function verifyCloudflareApiToken(): Promise<{
  ok?: boolean;
  status?: string;
  message?: string;
  error?: string;
}> {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth;

  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) {
    return { error: "missing_cloudflare_token" };
  }

  try {
    const res = await fetch(
      "https://api.cloudflare.com/client/v4/user/tokens/verify",
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );

    const json = (await res.json()) as {
      success?: boolean;
      result?: { status?: string };
      errors?: { message?: string }[];
    };

    if (json.success) {
      return {
        ok: true,
        status: json.result?.status ?? "active",
        message: json.result?.status ?? "active",
      };
    }

    const msg =
      json.errors?.[0]?.message ?? `HTTP ${res.status}: verification failed`;
    return { error: msg };
  } catch (e) {
    const message = e instanceof Error ? e.message : "verify_failed";
    return { error: message };
  }
}

export async function testStorageConnection(): Promise<{
  ok?: boolean;
  key?: string;
  steps?: string[];
  error?: string;
}> {
  const auth = await requireSuperAdmin();
  if (auth.error) return auth;

  try {
    invalidateR2ConfigCache();
    await resolveR2Config();
  } catch {
    return { error: "not_configured" };
  }

  const result = await runR2StorageProbe();
  if (!result.ok) {
    return {
      error: result.error ?? "connection_failed",
      key: result.key,
      steps: result.steps,
    };
  }

  return {
    ok: true,
    key: result.key,
    steps: result.steps,
  };
}
