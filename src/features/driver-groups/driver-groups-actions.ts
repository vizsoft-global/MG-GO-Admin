"use server";

import { staffClient } from "@/features/drivers/driver-uniqueness";

import { logAdminMutation } from "@/lib/audit/log-admin-activity";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { resolveDriversByLookupIds } from "@/features/drivers/resolve-drivers-by-lookup-ids";
import { parseSearchTerm } from "@/features/drivers/search-active-drivers";
import { lookupToImportMatch } from "@/features/drivers/resolve-import-row";
import {
  decideGroupImportRow,
  groupImportDisplayName,
  type GroupImportInputRow,
} from "./driver-group-import";
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

async function requireDriverGroupsManage(verb: "create" | "edit" | "delete" = "edit") {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(
      session.permissions,
      `driver_groups.${verb}` as Permission,
      session.isSuperAdmin,
    )
  ) {
    return null;
  }
  return session;
}

export async function listDriverGroups(): Promise<DriverGroupRow[]> {
  await requireDriverGroupsView();
  const db = (await staffClient()) as any;
  const { data, error } = await db
    .from("driver_groups")
    .select("*")
    .order("name");
  if (error) throw new Error(error.message);
  const { data: memberRows } = await db.from("driver_group_members").select("group_id");
  const counts = new Map<string, number>();
  for (const row of memberRows ?? []) {
    const groupId = String((row as { group_id?: string }).group_id ?? "");
    if (!groupId) continue;
    counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
  }
  return ((data ?? []) as DriverGroupRow[]).map((group) => ({
    ...group,
    member_count: counts.get(group.id) ?? 0,
  }));
}

export async function getDriverGroup(id: string): Promise<DriverGroupDetail | null> {
  await requireDriverGroupsView();
  const db = (await staffClient()) as any;
  const { data: group, error } = await db
    .from("driver_groups")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!group) return null;

  const { data: members } = await db
    .from("driver_group_members")
    .select("driver_id")
    .eq("group_id", id);

  const member_ids = (members ?? []).map((m: any) => m.driver_id as string);
  const memberRows =
    member_ids.length === 0
      ? []
      : (
          await db
            .from("drivers")
            .select("id, driver_code, employee_id, profiles!drivers_id_fkey(full_name)")
            .in("id", member_ids)
        ).data ?? [];

  return {
    ...(group as DriverGroupRow),
    member_count: member_ids.length,
    member_ids,
    members: memberRows.map((d: any) => {
      const profile = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
      return {
        id: d.id,
        driver_code: d.driver_code,
        employee_id: d.employee_id ?? "",
        full_name: profile?.full_name?.trim() || "Driver",
      };
    }),
  };
}

export async function listGroupsForDriver(driverId: string): Promise<DriverGroupSummary[]> {
  await requireDriverGroupsView();
  const db = (await staffClient()) as any;
  const { data, error } = await db
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

async function searchLiveDrivers(query: string, limit: number): Promise<DriverGroupMemberOption[]> {
  const { name, id } = parseSearchTerm(query);
  if (!name && !id) return [];

  const db = await staffClient();
  const orParts: string[] = [];
  if (id) {
    orParts.push(`employee_id.ilike.%${id}%`, `driver_code.ilike.%${id}%`);
  }
  if (name) {
    const like = `%${name}%`;
    const { data: nameRows } = await db
      .from("profiles")
      .select("id")
      .ilike("full_name", like)
      .limit(limit);
    const nameIds = new Set<string>((nameRows ?? []).map((row: { id: string }) => row.id));
    const { data: intakeRows } = await db
      .from("driver_intakes")
      .select("linked_profile_id")
      .ilike("full_name", like)
      .is("archived_at", null)
      .limit(limit);
    for (const row of intakeRows ?? []) {
      const linked = (row as { linked_profile_id?: string | null }).linked_profile_id;
      if (linked) nameIds.add(String(linked));
    }
    if (nameIds.size > 0) {
      orParts.push(`id.in.(${[...nameIds].join(",")})`);
    }
  }
  if (orParts.length === 0) return [];

  const { data, error } = await db
    .from("drivers")
    .select("id, driver_code, employee_id, profiles!drivers_id_fkey(full_name)")
    .is("archived_at", null)
    .or(orParts.join(","))
    .limit(limit);
  if (error) throw new Error(error.message);

  return (data ?? []).map((d: { id: string; driver_code: string; employee_id?: string | null; profiles?: { full_name?: string | null } | { full_name?: string | null }[] | null }) => {
    const profile = Array.isArray(d.profiles) ? d.profiles[0] : d.profiles;
    return {
      id: d.id,
      driver_code: d.driver_code,
      employee_id: d.employee_id ?? "",
      full_name: profile?.full_name?.trim() || "Driver",
    };
  });
}

export async function searchDriversForGroup(
  query: string,
  limit = 30,
): Promise<DriverGroupMemberOption[]> {
  await requireDriverGroupsView();
  return searchLiveDrivers(query, limit);
}

export async function resolveDriversByEmployeeIds(
  employeeIds: string[],
): Promise<
  Array<{
    employee_id: string;
    driver_id: string | null;
    driver_code: string | null;
    full_name: string | null;
    error: "not_found" | "blocked" | "archived" | null;
  }>
> {
  await requireDriverGroupsView();
  const db = (await staffClient()) as any;
  const resolved = await resolveDriversByLookupIds(db, employeeIds);
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
  const session = await requireDriverGroupsManage("create");
  if (!session) return { error: "not_authorized" };
  if (!input.name.trim()) return { error: "invalid_input" };

  const db = (await staffClient()) as any;
  const { data, error } = await db
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

  await syncGroupMembers(db, data.id, input.memberIds);

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
  const session = await requireDriverGroupsManage("edit");
  if (!session) return { error: "not_authorized" };
  if (!input.name.trim()) return { error: "invalid_input" };

  const db = (await staffClient()) as any;
  const { error } = await db
    .from("driver_groups")
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      icon_key: input.iconKey || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: "save_failed" };

  await syncGroupMembers(db, id, input.memberIds);

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
  const session = await requireDriverGroupsManage("delete");
  if (!session) return { error: "not_authorized" };

  const db = (await staffClient()) as any;
  await db.from("driver_group_members").delete().eq("group_id", id);
  const { error } = await db.from("driver_groups").delete().eq("id", id);
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
  db: any,
  groupId: string,
  memberIds: string[],
) {
  await db.from("driver_group_members").delete().eq("group_id", groupId);
  const unique = [...new Set(memberIds)];
  if (unique.length > 0) {
    await db.from("driver_group_members").insert(
      unique.map((driver_id: string) => ({ group_id: groupId, driver_id })),
    );
  }
  await db
    .from("driver_groups")
    .update({ member_count: unique.length, updated_at: new Date().toISOString() })
    .eq("id", groupId);
}

export type GroupImportPreviewRow = {
  row_number: number;
  employee_id: string;
  driver_code: string;
  full_name: string | null;
  status:
    | "ok"
    | "unknown_id"
    | "blocked"
    | "archived"
    | "ambiguous"
    | "mismatch"
    | "empty"
    | "already_in_group"
    | "duplicate";
};

export async function previewGroupMemberImport(
  groupId: string,
  rows: GroupImportInputRow[],
): Promise<GroupImportPreviewRow[]> {
  await requireDriverGroupsView();
  const db = (await staffClient()) as any;
  const { data: existing } = await db
    .from("driver_group_members")
    .select("driver_id")
    .eq("group_id", groupId);
  const existingIds = new Set((existing ?? []).map((m: { driver_id: string }) => m.driver_id));

  const lookups = [
    ...new Set(
      rows.flatMap((row) =>
        [row.employee_id, row.driver_code].map((v) => v?.trim()).filter(Boolean),
      ),
    ),
  ] as string[];
  const resolved = await resolveDriversByLookupIds(db, lookups);
  const byLookup = new Map(resolved.map((r) => [r.lookup_id, r]));
  const seenDrivers = new Set<string>();

  return rows.map((row, index) => {
    const employee_id = row.employee_id?.trim() ?? "";
    const driver_code = row.driver_code?.trim() ?? "";
    const name = row.name?.trim() ?? "";
    const toMatch = (r: (typeof resolved)[number] | undefined) =>
      r ? lookupToImportMatch(r) : null;
    const decided = decideGroupImportRow({
      employeeId: employee_id,
      driverCode: driver_code,
      name,
      byEmployee: toMatch(byLookup.get(employee_id)),
      byCode: toMatch(byLookup.get(driver_code)),
    });
    let status: GroupImportPreviewRow["status"] = decided.status;
    if (status === "ok" && decided.driver) {
      if (existingIds.has(decided.driver.driver_id)) status = "already_in_group";
      else if (seenDrivers.has(decided.driver.driver_id)) status = "duplicate";
      else seenDrivers.add(decided.driver.driver_id);
    }
    return {
      row_number: index + 1,
      employee_id,
      driver_code,
      full_name: groupImportDisplayName(status, name, decided.driver?.full_name ?? null),
      status,
    };
  });
}

export async function applyGroupMemberImport(
  groupId: string,
  rows: GroupImportInputRow[],
): Promise<{ added: number; rejected: number } | { error: string }> {
  const session = await requireDriverGroupsManage();
  if (!session) return { error: "not_authorized" };

  const preview = await previewGroupMemberImport(groupId, rows);
  const db = (await staffClient()) as any;
  const { data: existing } = await db
    .from("driver_group_members")
    .select("driver_id")
    .eq("group_id", groupId);
  const existingIds = new Set((existing ?? []).map((m: { driver_id: string }) => m.driver_id));

  const lookups = [
    ...new Set(
      rows.flatMap((row) =>
        [row.employee_id, row.driver_code].map((v) => v?.trim()).filter(Boolean),
      ),
    ),
  ] as string[];
  const resolved = await resolveDriversByLookupIds(db, lookups);
  const byLookup = new Map(resolved.map((r) => [r.lookup_id, r]));
  const toAdd: string[] = [];
  for (const row of rows) {
    const decided = decideGroupImportRow({
      employeeId: row.employee_id,
      driverCode: row.driver_code,
      name: row.name,
      byEmployee: (() => {
        const r = byLookup.get(row.employee_id?.trim() ?? "");
        return r ? lookupToImportMatch(r) : null;
      })(),
      byCode: (() => {
        const r = byLookup.get(row.driver_code?.trim() ?? "");
        return r ? lookupToImportMatch(r) : null;
      })(),
    });
    if (decided.status !== "ok" || !decided.driver) continue;
    if (existingIds.has(decided.driver.driver_id)) continue;
    if (toAdd.includes(decided.driver.driver_id)) continue;
    toAdd.push(decided.driver.driver_id);
  }

  if (toAdd.length > 0) {
    const { error } = await db.from("driver_group_members").insert(
      toAdd.map((driver_id) => ({ group_id: groupId, driver_id })),
    );
    if (error) return { error: "save_failed" };
  }

  await logAdminMutation({
    action: "update",
    entityType: "driver_group",
    entityId: groupId,
    routeName: "drivers/groups",
    context: { added: toAdd.length, previewed: preview.length },
  });

  return {
    added: toAdd.length,
    rejected: preview.filter((r) => r.status !== "ok").length,
  };
}
