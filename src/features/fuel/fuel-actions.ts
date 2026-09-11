"use server";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
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
    p_search: input.search?.trim() || null,
    p_project_key: input.projectKey || null,
    p_vehicle_type_key: null,
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
