"use server";

import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPresignedGetUrl } from "@/lib/storage/r2-client";

const DEFAULT_PAGE_SIZE = 24;

export type LoginVerificationListItem = {
  id: string;
  objectKey: string;
  capturedAt: string;
  createdAt: string;
  signedUrl: string | null;
};

export type LoginVerificationCursor = {
  createdAt: string;
  id: string;
};

export type ListDriverLoginVerificationsResult =
  | {
      ok: true;
      items: LoginVerificationListItem[];
      nextCursor: LoginVerificationCursor | null;
    }
  | { ok: false; error: string };

export async function listDriverLoginVerifications(params: {
  driverId: string;
  cursor?: LoginVerificationCursor | null;
  limit?: number;
  /** YYYY-MM-DD inclusive start on captured_at (UTC day) */
  startDate?: string | null;
  /** YYYY-MM-DD inclusive end on captured_at (UTC day) */
  endDate?: string | null;
}): Promise<ListDriverLoginVerificationsResult> {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "drivers.view", session.isSuperAdmin)
  ) {
    return { ok: false, error: "not_authorized" };
  }

  const driverId = params.driverId?.trim();
  if (!driverId) {
    return { ok: false, error: "invalid_driver" };
  }

  const limit = Math.min(
    Math.max(params.limit ?? DEFAULT_PAGE_SIZE, 1),
    50,
  );

  try {
    const admin = createAdminClient();
    let query = admin
      .from("driver_login_verifications")
      .select("id, object_key, captured_at, created_at")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    const start = params.startDate?.trim();
    const end = params.endDate?.trim();
    if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
      query = query.gte("captured_at", `${start}T00:00:00.000Z`);
    }
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
      query = query.lte("captured_at", `${end}T23:59:59.999Z`);
    }

    if (params.cursor?.createdAt && params.cursor?.id) {
      // Quote ISO timestamps so `:` does not break PostgREST filters.
      const cAt = `"${params.cursor.createdAt}"`;
      const cId = `"${params.cursor.id}"`;
      query = query.or(
        `created_at.lt.${cAt},and(created_at.eq.${cAt},id.lt.${cId})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return { ok: false, error: error.message };
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items: LoginVerificationListItem[] = await Promise.all(
      page.map(async (row) => {
        let signedUrl: string | null = null;
        try {
          signedUrl = await getPresignedGetUrl(row.object_key);
        } catch {
          signedUrl = null;
        }
        return {
          id: row.id,
          objectKey: row.object_key,
          capturedAt: row.captured_at,
          createdAt: row.created_at,
          signedUrl,
        };
      }),
    );

    const last = page[page.length - 1];
    const nextCursor: LoginVerificationCursor | null =
      hasMore && last
        ? { createdAt: last.created_at, id: last.id }
        : null;

    return { ok: true, items, nextCursor };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "list_failed",
    };
  }
}
