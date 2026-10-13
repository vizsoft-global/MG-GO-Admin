"use server";

import type { Firestore } from "firebase-admin/firestore";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { enqueueNotificationAutomationEvent } from "@/features/notifications/notifications-actions";
import type { PayoutRunDetail, PayoutRunRow } from "./types";

type FsRow = Record<string, unknown> & { id: string };

function isoOf(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  const ts = value as { toDate?: () => Date };
  if (typeof ts.toDate === "function") return ts.toDate().toISOString();
  return value;
}

function asRow(id: string, data: FirebaseFirestore.DocumentData | undefined): FsRow | null {
  if (!data) return null;
  const out: FsRow = { id };
  for (const [key, value] of Object.entries(data)) {
    out[key] = isoOf(value);
  }
  return out;
}

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

async function payoutDb(): Promise<Firestore | null> {
  return staffDb();
}

export async function listPayoutRuns(
  startDate: string,
  endDate: string,
): Promise<{ error: string } | { rows: PayoutRunRow[] }> {
  const session = await requireEarningsView();
  if (!session) return { error: "not_authorized" };

  const db = await payoutDb();
  if (!db) return { error: "not_configured" };

  const snap = await db.collection(COLLECTIONS.payoutRuns).get();
  let rows = snap.docs
    .map((doc) => asRow(doc.id, doc.data()))
    .filter((row): row is FsRow => row !== null)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

  if (startDate && endDate) {
    rows = rows.filter(
      (row) =>
        String(row.period_start ?? "") >= startDate && String(row.period_end ?? "") <= endDate,
    );
  }

  return { rows: rows as PayoutRunRow[] };
}

export async function generatePayoutRun(input: {
  periodStart: string;
  periodEnd: string;
  driverIds?: string[];
  notes?: string;
}): Promise<{ error: string } | { id: string }> {
  const session = await requireEarningsManage();
  if (!session) return { error: "not_authorized" };
  const { data, error } = await callAdminFunction("generate_payout_run", {
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
  const { error } = await callAdminFunction("approve_payout_run", { p_run_id: id });
  if (error) return { error: error.message ?? "save_failed" };
  return { ok: true };
}

export async function markPayoutRunPaid(
  id: string,
  reference?: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireEarningsManage();
  if (!session) return { error: "not_authorized" };
  const { error } = await callAdminFunction("mark_payout_run_paid", {
    p_run_id: id,
    p_reference: reference ?? null,
  });
  if (error) return { error: error.message ?? "save_failed" };

  const db = await payoutDb();
  if (db) {
    const lines = await db.collection(COLLECTIONS.driverPayouts).where("run_id", "==", id).get();
    for (const line of lines.docs) {
      const driverId = line.data().driver_id;
      if (typeof driverId !== "string" || !driverId) continue;
      void enqueueNotificationAutomationEvent({
        triggerType: "salary_processed",
        driverId,
        payload: { run_id: id },
      });
    }
  }

  return { ok: true };
}

export async function voidPayoutRun(
  id: string,
  reason?: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireEarningsManage();
  if (!session) return { error: "not_authorized" };
  const { error } = await callAdminFunction("void_payout_run", {
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
  const { data, error } = await callAdminFunction("get_payout_run_detail", {
    p_run_id: id,
  });
  if (error) return { error: error.message ?? "load_failed" };
  const payload = (data ?? {}) as Record<string, unknown>;
  return {
    run: (payload.run ?? {}) as Record<string, unknown>,
    lines: (payload.lines ?? []) as PayoutRunDetail["lines"],
  };
}
