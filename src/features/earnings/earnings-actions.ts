"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminRead } from "@/lib/audit/log-admin-activity";
import {
  runGetEarningsDetail,
  runListDriverEarningsDaily,
  runPreviewEarnings,
  runRecalculateEarnings,
  runRecalculateEarningsRange,
  runValidateDelivery,
} from "@/features/dpd/dpd-actions";
import { parseIncentiveDailyReport, type IncentiveDailyReport } from "./incentive-daily-report";

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

export async function fetchIncentiveDailyReport(input: {
  from: string;
  to: string;
  driverId?: string;
  restaurantId?: string;
}): Promise<IncentiveDailyReport> {
  const session = await requireEarningsView();
  if (!session) throw new Error("not_authorized");
  const from = input.from.slice(0, 10);
  const to = input.to.slice(0, 10);
  if (!from || !to || to < from) throw new Error("invalid_date_range");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_incentive_daily_report", {
    p_from: from,
    p_to: to,
    p_driver_id: input.driverId || undefined,
    p_restaurant_id: input.restaurantId || undefined,
  });
  if (error) throw new Error(error.message);

  void logAdminRead("driver_earnings_daily", "fetchIncentiveDailyReport", {
    from,
    to,
    driverId: input.driverId,
    restaurantId: input.restaurantId,
  });

  return parseIncentiveDailyReport(data, from, to);
}

export async function fetchIncentiveDailyDrivers(): Promise<
  Array<{ id: string; driver_code: string; employee_id: string; full_name: string }>
> {
  const session = await requireEarningsView();
  if (!session) throw new Error("not_authorized");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drivers")
    .select("id, driver_code, employee_id, profiles!drivers_id_fkey(full_name)")
    .is("archived_at", null)
    .order("driver_code")
    .limit(2000);
  if (error) throw new Error(error.message);

  void logAdminRead("drivers", "fetchIncentiveDailyDrivers");

  return (data ?? []).map((d) => {
    const profile = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
    return {
      id: d.id,
      driver_code: d.driver_code,
      employee_id: d.employee_id ?? "",
      full_name: profile?.full_name?.trim() || "Driver",
    };
  });
}
