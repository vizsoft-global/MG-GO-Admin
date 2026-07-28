"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import {
  runGetEarningsDetail,
  runListDriverEarningsDaily,
  runPreviewEarnings,
  runRecalculateEarnings,
  runRecalculateEarningsRange,
  runValidateDelivery,
} from "@/features/dpd/dpd-actions";

async function requireEarningsView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "earnings.view", session.isSuperAdmin)
  ) {
    return null;
  }
  return session;
}

export {
  runGetEarningsDetail,
  runListDriverEarningsDaily,
  runPreviewEarnings,
  runRecalculateEarnings,
  runRecalculateEarningsRange,
  runValidateDelivery,
};

export async function runGetEarningsOverview(
  startDate: string,
  endDate: string,
  filters?: {
    driver_ids?: string[];
    zone_ids?: string[];
    partner_ids?: string[];
    restaurant_ids?: string[];
  },
): Promise<{ error: string } | { data: Record<string, unknown> }> {
  const session = await requireEarningsView();
  if (!session) return { error: "not_authorized" };
  if (!startDate || !endDate) return { error: "missing_fields" };

  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("get_earnings_overview", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_filters: filters ?? {},
  });

  if (error) return { error: error.message ?? "load_failed" };
  return { data: (data ?? {}) as Record<string, unknown> };
}

export async function runListEarningsGrouped(
  startDate: string,
  endDate: string,
  groupBy: "day" | "driver" | "zone" | "partner" | "restaurant",
  filters?: {
    driver_ids?: string[];
    zone_ids?: string[];
    partner_ids?: string[];
    restaurant_ids?: string[];
  },
): Promise<{ error: string } | { rows: Record<string, unknown>[] }> {
  const session = await requireEarningsView();
  if (!session) return { error: "not_authorized" };
  if (!startDate || !endDate) return { error: "missing_fields" };

  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("list_earnings_grouped", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_group_by: groupBy,
    p_filters: filters ?? {},
  });

  if (error) return { error: error.message ?? "load_failed" };
  return { rows: Array.isArray((data as any)?.rows) ? (data as any).rows : [] };
}
