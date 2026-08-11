"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import type {
  AccessLevel,
  ComplaintCategoryRow,
  DepartmentMemberRow,
  DepartmentRoleTitle,
  DepartmentRow,
  RequestTypeScreenshotPolicyRow,
  RequestTypeSlug,
  StaffAccessRow,
  StaffProfileOption,
  StepTemplateRow,
} from "./settings-types";

async function requireRequestsManage() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "requests.manage", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function fetchStepTemplates(requestType: RequestTypeSlug): Promise<{
  steps: StepTemplateRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("request_approval_step_templates")
    .select("id, step_order, step_name, role_key, is_system_auto, allowed_actions")
    .eq("request_type", requestType)
    .order("step_order");

  if (error) return { steps: [], error: error.message };

  await logAdminRead("requests", "requests.settings.workflows.list", {
    requestType,
  });

  return {
    steps: (data ?? []).map((row) => ({
      id: row.id,
      step_order: row.step_order,
      step_name: row.step_name,
      role_key: row.role_key,
      is_system_auto: row.is_system_auto,
      allowed_actions: Array.isArray(row.allowed_actions) ? row.allowed_actions : [],
    })),
  };
}

export async function upsertStepTemplates(
  requestType: RequestTypeSlug,
  steps: StepTemplateRow[],
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();

  const payload = steps.map((step) => ({
    step_order: step.step_order,
    step_name: step.step_name.trim(),
    role_key: step.role_key.trim(),
    is_system_auto: step.is_system_auto,
    allowed_actions: step.is_system_auto ? [] : step.allowed_actions,
  }));

  const { data, error } = await supabase.rpc("admin_upsert_step_template", {
    p_request_type: requestType,
    p_steps: payload,
  });

  if (error) return { ok: false, error: error.message };
  const result = asRecord(data);
  if (result.ok === false) {
    return { ok: false, error: String(result.error ?? "failed") };
  }

  await logAdminMutation({
    action: "update",
    entityType: "requests",
    entityId: requestType,
    routeName: "requests.settings.workflows.save",
    context: { stepCount: steps.length },
  });

  return { ok: true };
}

export async function fetchComplaintCategories(): Promise<{
  rows: ComplaintCategoryRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("complaint_categories")
    .select("id, key, label_en, label_ar, is_active, sort_order")
    .order("sort_order")
    .order("label_en");

  if (error) return { rows: [], error: error.message };

  await logAdminRead("requests", "requests.settings.categories.list", {});

  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      key: row.key,
      label_en: row.label_en,
      label_ar: row.label_ar,
      is_active: row.is_active,
      sort_order: row.sort_order,
    })),
  };
}

export async function upsertComplaintCategory(input: {
  id?: string;
  key: string;
  label_en: string;
  label_ar?: string | null;
  is_active?: boolean;
  sort_order?: number;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const key = input.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const label_en = input.label_en.trim();
  if (!key || !label_en) return { ok: false, error: "missing_fields" };

  const row = {
    key,
    label_en,
    label_ar: input.label_ar?.trim() || null,
    is_active: input.is_active ?? true,
    sort_order: input.sort_order ?? 0,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await supabase
      .from("complaint_categories")
      .update(row)
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    await logAdminMutation({
      action: "update",
      entityType: "complaint_categories",
      entityId: input.id,
      routeName: "requests.settings.categories.update",
    });
    return { ok: true, id: input.id };
  }

  const { data, error } = await supabase
    .from("complaint_categories")
    .insert(row)
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "create",
    entityType: "complaint_categories",
    entityId: data.id,
    routeName: "requests.settings.categories.create",
  });
  return { ok: true, id: data.id };
}

export async function deleteComplaintCategory(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { error } = await supabase.from("complaint_categories").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "delete",
    entityType: "complaint_categories",
    entityId: id,
    routeName: "requests.settings.categories.delete",
  });
  return { ok: true };
}

export async function fetchStaffAccess(): Promise<{
  rows: StaffAccessRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("request_staff_access")
    .select(
      "id, profile_id, request_type, access_level, profiles(full_name, email)",
    )
    .order("request_type")
    .order("created_at");

  if (error) return { rows: [], error: error.message };

  await logAdminRead("requests", "requests.settings.staff_access.list", {});

  return {
    rows: (data ?? []).map((row) => {
      const profile = asRecord(row.profiles);
      return {
        id: row.id,
        profile_id: row.profile_id,
        profile_name: String(profile.full_name ?? "—"),
        profile_email: profile.email != null ? String(profile.email) : null,
        request_type: String(row.request_type),
        access_level: row.access_level as "view_only" | "approver",
      };
    }),
  };
}

export async function fetchStaffProfileOptions(): Promise<StaffProfileOption[]> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "staff")
    .eq("approval_status", "approved")
    .order("full_name");

  return (data ?? []).map((row) => ({
    id: row.id,
    full_name: row.full_name ?? "—",
    email: row.email,
  }));
}

export async function upsertStaffAccess(input: {
  id?: string;
  profile_id: string;
  request_type: RequestTypeSlug;
  access_level: "view_only" | "approver";
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();

  if (input.id) {
    const { error } = await supabase
      .from("request_staff_access")
      .update({
        profile_id: input.profile_id,
        request_type: input.request_type,
        access_level: input.access_level,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    await logAdminMutation({
      action: "update",
      entityType: "request_staff_access",
      entityId: input.id,
      routeName: "requests.settings.staff_access.update",
    });
    return { ok: true, id: input.id };
  }

  const { data, error } = await supabase
    .from("request_staff_access")
    .upsert(
      {
        profile_id: input.profile_id,
        request_type: input.request_type,
        access_level: input.access_level,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,request_type" },
    )
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "create",
    entityType: "request_staff_access",
    entityId: data.id,
    routeName: "requests.settings.staff_access.create",
  });
  return { ok: true, id: data.id };
}

export async function deleteStaffAccess(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { error } = await supabase.from("request_staff_access").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "delete",
    entityType: "request_staff_access",
    entityId: id,
    routeName: "requests.settings.staff_access.delete",
  });
  return { ok: true };
}

export type RequestsAuditLogRow = {
  id: string;
  action: string;
  route_name: string | null;
  entity_id: string | null;
  created_at: string;
};

export async function fetchRequestsAuditLogs(): Promise<{
  rows: RequestsAuditLogRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("admin_activity_logs")
    .select("id, action, route_name, entity_id, created_at")
    .eq("entity_type", "requests")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { rows: [], error: error.message };
  return { rows: data ?? [] };
}

export async function fetchRequestTypeScreenshotPolicy(): Promise<{
  rows: RequestTypeScreenshotPolicyRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("request_type_screenshot_policy")
    .select("request_type, screenshot_restricted, is_active")
    .order("request_type");

  if (error) return { rows: [], error: error.message };
  return {
    rows: (data ?? []).map((row: Record<string, unknown>) => ({
      request_type: row.request_type as RequestTypeSlug,
      screenshot_restricted: Boolean(row.screenshot_restricted),
      is_active: Boolean(row.is_active),
    })),
  };
}

export async function updateRequestTypeScreenshotPolicy(
  requestType: RequestTypeSlug,
  patch: { screenshot_restricted?: boolean; is_active?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { error } = await (supabase as any)
    .from("request_type_screenshot_policy")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("request_type", requestType);

  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "update",
    entityType: "request_type_screenshot_policy",
    entityId: requestType,
    routeName: "requests.settings.screenshot.update",
    context: patch,
  });
  return { ok: true };
}

export async function fetchStaffAccessMatrix(): Promise<{
  staffOptions: StaffProfileOption[];
  rows: StaffAccessRow[];
  error?: string;
}> {
  const [accessResult, staff] = await Promise.all([
    fetchStaffAccess(),
    fetchStaffProfileOptions(),
  ]);
  return { staffOptions: staff, rows: accessResult.rows, error: accessResult.error };
}

export async function fetchDepartments(): Promise<{
  rows: DepartmentRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("request_departments")
    .select("id, key, label_en, label_ar, is_active, sort_order, request_department_members(count)")
    .order("sort_order")
    .order("label_en");

  if (error) return { rows: [], error: error.message };

  await logAdminRead("requests", "requests.settings.departments.list", {});

  return {
    rows: (data ?? []).map((row: Record<string, unknown>) => ({
      id: String(row.id),
      key: String(row.key),
      label_en: String(row.label_en),
      label_ar: row.label_ar != null ? String(row.label_ar) : null,
      is_active: Boolean(row.is_active),
      sort_order: Number(row.sort_order ?? 0),
      member_count: Number(
        (row.request_department_members as { count: number }[] | undefined)?.[0]?.count ?? 0,
      ),
    })),
  };
}

export async function upsertDepartment(input: {
  id?: string;
  key: string;
  label_en: string;
  label_ar?: string | null;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const key = input.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const label_en = input.label_en.trim();
  if (!key || !label_en) return { ok: false, error: "missing_fields" };

  const row = {
    key,
    label_en,
    label_ar: input.label_ar?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await (supabase as any)
      .from("request_departments")
      .update(row)
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    await logAdminMutation({
      action: "update",
      entityType: "request_departments",
      entityId: input.id,
      routeName: "requests.settings.departments.update",
    });
    return { ok: true, id: input.id };
  }

  const { data, error } = await (supabase as any)
    .from("request_departments")
    .insert(row)
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "create",
    entityType: "request_departments",
    entityId: data.id,
    routeName: "requests.settings.departments.create",
  });
  return { ok: true, id: data.id };
}

export async function deleteDepartment(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { error } = await (supabase as any).from("request_departments").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "delete",
    entityType: "request_departments",
    entityId: id,
    routeName: "requests.settings.departments.delete",
  });
  return { ok: true };
}

export async function fetchDepartmentMembers(departmentId: string): Promise<{
  rows: DepartmentMemberRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from("request_department_members")
    .select("id, department_id, profile_id, role_title, is_active, profiles(full_name, email)")
    .eq("department_id", departmentId)
    .order("created_at");

  if (error) return { rows: [], error: error.message };

  return {
    rows: (data ?? []).map((row: Record<string, unknown>) => {
      const profile = asRecord(row.profiles);
      return {
        id: String(row.id),
        department_id: String(row.department_id),
        profile_id: String(row.profile_id),
        profile_name: String(profile.full_name ?? "—"),
        profile_email: profile.email != null ? String(profile.email) : null,
        role_title: row.role_title as DepartmentRoleTitle,
        is_active: Boolean(row.is_active),
      };
    }),
  };
}

export async function addDepartmentMember(input: {
  department_id: string;
  profile_id: string;
  role_title: DepartmentRoleTitle;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { error } = await (supabase as any).from("request_department_members").upsert(
    {
      department_id: input.department_id,
      profile_id: input.profile_id,
      role_title: input.role_title,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "department_id,profile_id" },
  );
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "create",
    entityType: "request_department_members",
    entityId: input.profile_id,
    routeName: "requests.settings.departments.addMember",
    context: { department_id: input.department_id },
  });
  return { ok: true };
}

export async function updateDepartmentMemberStatus(
  id: string,
  is_active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { error } = await (supabase as any)
    .from("request_department_members")
    .update({ is_active, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "update",
    entityType: "request_department_members",
    entityId: id,
    routeName: "requests.settings.departments.toggleMember",
    context: { is_active },
  });
  return { ok: true };
}

export async function removeDepartmentMember(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { error } = await (supabase as any)
    .from("request_department_members")
    .delete()
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "delete",
    entityType: "request_department_members",
    entityId: id,
    routeName: "requests.settings.departments.removeMember",
  });
  return { ok: true };
}

export async function saveStaffAccessGrants(
  profileId: string,
  grants: Partial<Record<RequestTypeSlug, AccessLevel>>,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();

  for (const [requestType, level] of Object.entries(grants) as [RequestTypeSlug, AccessLevel][]) {
    if (!level || level === "none") {
      const { error } = await supabase
        .from("request_staff_access")
        .delete()
        .eq("profile_id", profileId)
        .eq("request_type", requestType);
      if (error) return { ok: false, error: error.message };
      continue;
    }
    const { error } = await supabase.from("request_staff_access").upsert(
      {
        profile_id: profileId,
        request_type: requestType,
        access_level: level,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,request_type" },
    );
    if (error) return { ok: false, error: error.message };
  }

  await logAdminMutation({
    action: "update",
    entityType: "request_staff_access",
    entityId: profileId,
    routeName: "requests.settings.roles.saveGrants",
    context: { grants },
  });

  return { ok: true };
}
