"use server";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { resolveDriversByLookupIds } from "@/features/drivers/resolve-drivers-by-lookup-ids";
import type {
  DriverGroupDetail,
  DriverGroupMemberOption,
  DriverGroupRow,
  DriverGroupSummary,
} from "./types";

async function requireDriverGroupsView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "driver_groups.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireDriverGroupsManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "driver_groups.manage", session.isSuperAdmin)
  ) {
    return null;
  }
  return session;
}

export async function listDriverGroups(): Promise<DriverGroupRow[]> {
  await requireDriverGroupsView();
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("driver_groups")
    .select("*")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as DriverGroupRow[];
}

export async function getDriverGroup(id: string): Promise<DriverGroupDetail | null> {
  await requireDriverGroupsView();
  const supabase = (await createClient()) as any;
  const { data: group, error } = await supabase
    .from("driver_groups")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!group) return null;

  const { data: members } = await supabase
    .from("driver_group_members")
    .select("driver_id")
    .eq("group_id", id);

  return {
    ...(group as DriverGroupRow),
    member_ids: (members ?? []).map((m: any) => m.driver_id),
  };
}

export async function listGroupsForDriver(driverId: string): Promise<DriverGroupSummary[]> {
  await requireDriverGroupsView();
  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("driver_group_members")
    .select("group_id, driver_groups(id, name, icon_key)")
    .eq("driver_id", driverId);
  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row: any) => {
      const g = row.driver_groups as { id: string; name: string; icon_key: string | null } | null;
      if (!g) return null;
      return { id: g.id, name: g.name, icon_key: g.icon_key };
    })
    .filter((g: any): g is DriverGroupSummary => Boolean(g));
}

export async function searchDriversForGroup(
  query: string,
  limit = 30,
): Promise<DriverGroupMemberOption[]> {
  await requireDriverGroupsView();
  const supabase = (await createClient()) as any;
  const term = query.trim();
  if (!term) return [];

  let q = supabase
    .from("drivers")
    .select("id, driver_code, employee_id, profiles(full_name)")
    .is("archived_at", null)
    .limit(limit);

  if (/^\d+$/.test(term)) {
    q = q.or(`employee_id.eq.${term},driver_code.ilike.%${term}%`);
  } else {
    q = q.or(`driver_code.ilike.%${term}%,employee_id.ilike.%${term}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data ?? []).map((d: any) => {
    const profile = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
    return {
      id: d.id,
      driver_code: d.driver_code,
      employee_id: d.employee_id ?? "",
      full_name: profile?.full_name?.trim() || "Driver",
    };
  });
}

export async function resolveDriversByEmployeeIds(
  employeeIds: string[],
): Promise<
  Array<{
    employee_id: string;
    driver_id: string | null;
    driver_code: string | null;
    full_name: string | null;
    error: "not_found" | "blocked" | null;
  }>
> {
  await requireDriverGroupsView();
  const supabase = (await createClient()) as any;
  const resolved = await resolveDriversByLookupIds(supabase, employeeIds);
  return resolved.map((row) => ({
    employee_id: row.employee_id,
    driver_id: row.driver_id,
    driver_code: row.driver_code,
    full_name: row.full_name,
    error: row.error,
  }));
}

export type SaveDriverGroupInput = {
  name: string;
  description?: string | null;
  iconKey?: string | null;
  memberIds: string[];
};

export async function createDriverGroup(
  input: SaveDriverGroupInput,
): Promise<{ id: string } | { error: string }> {
  const session = await requireDriverGroupsManage();
  if (!session) return { error: "not_authorized" };
  if (!input.name.trim()) return { error: "invalid_input" };

  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("driver_groups")
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      icon_key: input.iconKey || null,
      created_by: session.id,
    })
    .select("id")
    .single();
  if (error) return { error: "save_failed" };

  await syncGroupMembers(supabase, data.id, input.memberIds);

  await logAdminMutation({
    action: "create",
    entityType: "driver_group",
    entityId: data.id,
    routeName: "drivers/groups",
    context: { memberCount: input.memberIds.length },
  });

  return { id: data.id };
}

export async function updateDriverGroup(
  id: string,
  input: SaveDriverGroupInput,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireDriverGroupsManage();
  if (!session) return { error: "not_authorized" };
  if (!input.name.trim()) return { error: "invalid_input" };

  const supabase = (await createClient()) as any;
  const { error } = await supabase
    .from("driver_groups")
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      icon_key: input.iconKey || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: "save_failed" };

  await syncGroupMembers(supabase, id, input.memberIds);

  await logAdminMutation({
    action: "update",
    entityType: "driver_group",
    entityId: id,
    routeName: "drivers/groups",
    context: { memberCount: input.memberIds.length },
  });

  return { ok: true };
}

export async function deleteDriverGroup(id: string): Promise<{ ok: true } | { error: string }> {
  const session = await requireDriverGroupsManage();
  if (!session) return { error: "not_authorized" };

  const supabase = (await createClient()) as any;
  const { error } = await supabase.from("driver_groups").delete().eq("id", id);
  if (error) return { error: "save_failed" };

  await logAdminMutation({
    action: "delete",
    entityType: "driver_group",
    entityId: id,
    routeName: "drivers/groups",
  });

  return { ok: true };
}

async function syncGroupMembers(
  supabase: any,
  groupId: string,
  memberIds: string[],
) {
  await supabase.from("driver_group_members").delete().eq("group_id", groupId);
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return;
  await supabase.from("driver_group_members").insert(
    unique.map((driver_id) => ({ group_id: groupId, driver_id })),
  );
}
