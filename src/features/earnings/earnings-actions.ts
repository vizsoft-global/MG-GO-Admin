"use server";

import type { Firestore } from "firebase-admin/firestore";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
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

async function earningsDb(): Promise<Firestore | null> {
  return staffDb();
}

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

  const { data, error } = await callAdminFunction("get_earnings_overview", {
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

  const { data, error } = await callAdminFunction("list_earnings_grouped", {
    p_start_date: startDate,
    p_end_date: endDate,
    p_group_by: groupBy,
    p_filters: filters ?? {},
  });

  if (error) return { error: error.message ?? "load_failed" };
  const payload = data as { rows?: unknown } | null;
  return { rows: Array.isArray(payload?.rows) ? (payload.rows as Record<string, unknown>[]) : [] };
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

  const { data, error } = await callAdminFunction("admin_incentive_daily_report", {
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

  const db = await earningsDb();
  if (!db) throw new Error("not_configured");

  const snap = await db
    .collection(COLLECTIONS.drivers)
    .where("archived_at", "==", null)
    .limit(2000)
    .get();

  const drivers = snap.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        driver_code: String(data.driver_code ?? ""),
        employee_id: data.employee_id == null ? "" : String(data.employee_id),
      };
    })
    .sort((a, b) => a.driver_code.localeCompare(b.driver_code));

  const names = new Map<string, string>();
  for (let i = 0; i < drivers.length; i += 100) {
    const chunk = drivers.slice(i, i + 100);
    const profiles = await db.getAll(
      ...chunk.map((driver) => db.collection(COLLECTIONS.profiles).doc(driver.id)),
    );
    for (const profile of profiles) {
      const fullName = profile.data()?.full_name;
      if (typeof fullName === "string" && fullName.trim()) names.set(profile.id, fullName.trim());
    }
  }

  void logAdminRead("drivers", "fetchIncentiveDailyDrivers");

  return drivers.map((driver) => ({
    id: driver.id,
    driver_code: driver.driver_code,
    employee_id: driver.employee_id,
    full_name: names.get(driver.id) || "Driver",
  }));
}
