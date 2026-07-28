"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { enqueueNotificationAutomationEvent } from "@/features/notifications/notifications-actions";
import type { PayoutRunDetail, PayoutRunRow } from "./types";

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

async function requireEarningsManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "earnings.manage", session.isSuperAdmin)
  ) {
    return null;
  }
  return session;
}

export async function listPayoutRuns(
  startDate: string,
  endDate: string,
): Promise<{ error: string } | { rows: PayoutRunRow[] }> {
  const session = await requireEarningsView();
  if (!session) return { error: "not_authorized" };

  const supabase = await createClient();
  const query = (supabase as any)
    .from("payout_runs")
    .select("*")
    .order("created_at", { ascending: false });
  if (startDate && endDate) {
    query.gte("period_start", startDate).lte("period_end", endDate);
  }
  const { data, error } = await query;
  if (error) return { error: error.message ?? "load_failed" };
  return { rows: (data ?? []) as PayoutRunRow[] };
}

export async function generatePayoutRun(input: {
  periodStart: string;
  periodEnd: string;
  driverIds?: string[];
  notes?: string;
}): Promise<{ error: string } | { id: string }> {
  const session = await requireEarningsManage();
  if (!session) return { error: "not_authorized" };
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("generate_payout_run", {
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_driver_ids: input.driverIds ?? undefined,
    p_notes: input.notes ?? null,
  });
  if (error) return { error: error.message ?? "save_failed" };
  return { id: String(data) };
}

export async function approvePayoutRun(id: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireEarningsManage();
  if (!session) return { error: "not_authorized" };
  const supabase = await createClient();
  const { error } = await (supabase as any).rpc("approve_payout_run", { p_run_id: id });
  if (error) return { error: error.message ?? "save_failed" };
  return { ok: true };
}

export async function markPayoutRunPaid(
  id: string,
  reference?: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireEarningsManage();
  if (!session) return { error: "not_authorized" };
  const supabase = await createClient();
  const { error } = await (supabase as any).rpc("mark_payout_run_paid", {
    p_run_id: id,
    p_reference: reference ?? null,
  });
  if (error) return { error: error.message ?? "save_failed" };

  const { data: payoutLines } = await (supabase as any)
    .from("driver_payouts")
    .select("driver_id")
    .eq("run_id", id);
  for (const line of payoutLines ?? []) {
    void enqueueNotificationAutomationEvent({
      triggerType: "salary_processed",
      driverId: line.driver_id as string,
      payload: { run_id: id },
    });
  }

  return { ok: true };
}

export async function voidPayoutRun(
  id: string,
  reason?: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireEarningsManage();
  if (!session) return { error: "not_authorized" };
  const supabase = await createClient();
  const { error } = await (supabase as any).rpc("void_payout_run", {
    p_run_id: id,
    p_reason: reason ?? null,
  });
  if (error) return { error: error.message ?? "save_failed" };
  return { ok: true };
}

export async function getPayoutRunDetail(
  id: string,
): Promise<{ error: string } | PayoutRunDetail> {
  const session = await requireEarningsView();
  if (!session) return { error: "not_authorized" };
  const supabase = await createClient();
  const { data, error } = await (supabase as any).rpc("get_payout_run_detail", {
    p_run_id: id,
  });
  if (error) return { error: error.message ?? "load_failed" };
  const payload = (data ?? {}) as Record<string, unknown>;
  return {
    run: (payload.run ?? {}) as Record<string, unknown>,
    lines: (payload.lines ?? []) as PayoutRunDetail["lines"],
  };
}
