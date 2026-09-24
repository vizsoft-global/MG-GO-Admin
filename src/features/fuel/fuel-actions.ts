"use server";

import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { parseFuelFillRow } from "./fuel-week";
import type { FuelFillListItem } from "./types";

async function requireFuelView() {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "fuel.view", session.isSuperAdmin)) {
    return { error: "not_authorized" as const };
  }
  return { session };
}

export async function fetchFuelFillAttachmentUrl(
  storageKey: string,
): Promise<{ url: string | null; error?: string }> {
  const auth = await requireFuelView();
  if ("error" in auth) throw new Error(auth.error);

  const normalized = storageKey.trim().replace(/^\/+/, "");
  if (!normalized) return { url: null };
  const objectKey = normalized.startsWith("fuel-fills/")
    ? normalized.slice("fuel-fills/".length)
    : normalized;

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("fuel-fills").createSignedUrl(objectKey, 300);
  if (error) return { url: null, error: error.message };
  return { url: data?.signedUrl ?? null };
}

export async function listFuelFills(input: {
  from: string;
  to: string;
  search?: string;
  projectKey?: string | null;
}): Promise<FuelFillListItem[]> {
  const auth = await requireFuelView();
  if ("error" in auth) throw new Error(auth.error);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_fuel_fills", {
    p_from: input.from,
    p_to: input.to,
    p_search: input.search?.trim() || undefined,
    p_project_key: input.projectKey || undefined,
    p_limit: 2000,
    p_offset: 0,
  });
  if (error) throw new Error(error.message);

  const payload = data as { ok?: boolean; rows?: unknown } | null;
  if (!payload?.ok || !Array.isArray(payload.rows)) return [];

  void logAdminRead("fuel_fills", "/fuel");
  return payload.rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const parsed = parseFuelFillRow(row as Record<string, unknown>);
    return parsed ? [parsed] : [];
  });
}

export type FuelWithdrawnOverride = {
  driverId: string;
  vehicleId: string;
  amountKwd: number;
};

const MONTH_KEY = /^\d{4}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listFuelWithdrawnOverrides(monthKey: string): Promise<FuelWithdrawnOverride[]> {
  const auth = await requireFuelView();
  if ("error" in auth) throw new Error(auth.error);
  if (!MONTH_KEY.test(monthKey)) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fuel_withdrawn_overrides")
    .select("driver_id, vehicle_id, amount_kwd")
    .eq("month_key", monthKey);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const amount = Number(row.amount_kwd);
    if (!row.driver_id || !row.vehicle_id || !Number.isFinite(amount)) return [];
    return [{ driverId: row.driver_id, vehicleId: row.vehicle_id, amountKwd: amount }];
  });
}

export async function saveFuelWithdrawnOverride(input: {
  driverId: string;
  vehicleId: string;
  monthKey: string;
  amountKwd: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireFuelView();
  if ("error" in auth) return { ok: false, error: auth.error ?? "not_authorized" };
  if (!UUID.test(input.driverId) || !UUID.test(input.vehicleId) || !MONTH_KEY.test(input.monthKey)) {
    return { ok: false, error: "invalid" };
  }
  if (!Number.isFinite(input.amountKwd) || input.amountKwd < 0 || input.amountKwd > 999_999) {
    return { ok: false, error: "invalid_amount" };
  }
  const amountKwd = Math.round(input.amountKwd * 1000) / 1000;

  const supabase = await createClient();
  const { error } = await supabase.from("fuel_withdrawn_overrides").upsert(
    {
      driver_id: input.driverId,
      vehicle_id: input.vehicleId,
      month_key: input.monthKey,
      amount_kwd: amountKwd,
      updated_at: new Date().toISOString(),
      updated_by: auth.session.id,
    },
    { onConflict: "driver_id,vehicle_id,month_key" },
  );
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "update",
    entityType: "fuel_withdrawn_overrides",
    entityId: input.vehicleId,
    routeName: "/fuel",
    after: { driverId: input.driverId, monthKey: input.monthKey, amountKwd },
  });
  return { ok: true };
}
