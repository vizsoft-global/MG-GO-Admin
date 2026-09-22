"use server";

import { logAdminRead } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

async function requireZonesView() {
  const session = await getSessionUser();
  if (!session || !hasPermissionInSet(session.permissions, "zones.view", session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
  return session;
}

export type ZoneAssistantRow = {
  id: string;
  name: string;
  code: string;
};

/** Staff list for assistant — id/name/code only, no geometry. */
export async function listZonesForAssistant(): Promise<ZoneAssistantRow[]> {
  await requireZonesView();
  void logAdminRead("zones", "listZonesForAssistant", {});
  const supabase = await createClient();
  const { data, error } = await supabase.from("zones").select("id, name, code").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    code: String(row.code ?? ""),
  }));
}
