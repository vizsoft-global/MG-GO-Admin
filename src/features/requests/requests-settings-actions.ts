"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import type {
  AccessLevel,
  AppointmentStatusCounts,
  ComplaintCategoryRow,
  DepartmentMemberRow,
  DepartmentRoleTitle,
  DepartmentRow,
  RequestDepartmentReportRow,
  RequestTypeScreenshotPolicyRow,
  RequestTypeSlug,
  SettingsHubCounts,
  StaffAccessRow,
  StaffDepartmentMap,
  StaffProfileOption,
  StepTemplateRow,
} from "./settings-types";

const GRANTABLE_ACCESS_LEVELS: AccessLevel[] = ["view_only", "approver"];

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
  /** Actor name + role, shown in the Figma ACTOR column. */
  actor_id: string | null;
  actor_name: string;
  actor_role: string | null;
  /** Human-readable summary built from changed fields / context. */
  details: string | null;
  /** RCM-#### code of the request the row is about, when it can be resolved. */
  target_code: string | null;
  target_type: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Compact "field: value" summary for the Figma DETAILS column. */
function summarizeLogContext(
  context: unknown,
  changedFields: unknown,
  errorMessage: string | null,
): string | null {
  if (errorMessage) return errorMessage;
  const fields = Array.isArray(changedFields)
    ? changedFields.map(String).filter(Boolean)
    : [];
  if (fields.length > 0) return fields.join(", ");
  const record = asRecord(context);
  const parts = Object.entries(record)
    .filter(([, value]) => value != null && typeof value !== "object")
    // Raw ids are noise in the DETAILS column; the TARGET column carries the request code.
    .filter(([, value]) => !UUID_RE.test(String(value)))
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export async function fetchRequestsAuditLogs(): Promise<{
  rows: RequestsAuditLogRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("admin_activity_logs")
    .select(
      "id, action, route_name, entity_id, created_at, admin_user_id, admin_role_slug, context, changed_fields, error_message",
    )
    .eq("entity_type", "requests")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { rows: [], error: error.message };

  const actorIds = Array.from(
    new Set((data ?? []).map((row) => row.admin_user_id).filter((id): id is string => Boolean(id))),
  );
  const nameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds);
    for (const profile of profiles ?? []) {
      if (profile.full_name) nameById.set(profile.id, profile.full_name);
    }
  }

  const requestIds = Array.from(
    new Set(
      (data ?? [])
        .flatMap((row) => [row.entity_id, asRecord(row.context).requestId])
        .filter((id): id is string => typeof id === "string" && UUID_RE.test(id)),
    ),
  );
  const requestById = new Map<string, { code: string | null; type: string | null }>();
  if (requestIds.length > 0) {
    const { data: requests } = await supabase
      .from("requests")
      .select("id, request_code, request_type")
      .in("id", requestIds);
    for (const request of requests ?? []) {
      requestById.set(request.id, {
        code: request.request_code,
        type: request.request_type,
      });
    }
  }

  return {
    rows: (data ?? []).map((row) => {
      const contextRequestId = asRecord(row.context).requestId;
      const target =
        requestById.get(row.entity_id ?? "") ??
        (typeof contextRequestId === "string" ? requestById.get(contextRequestId) : undefined);
      return {
        id: row.id,
        action: row.action,
        route_name: row.route_name,
        entity_id: row.entity_id,
        created_at: row.created_at,
        actor_id: row.admin_user_id,
        actor_name: row.admin_user_id ? (nameById.get(row.admin_user_id) ?? "—") : "System",
        actor_role: row.admin_role_slug,
        details: summarizeLogContext(row.context, row.changed_fields, row.error_message),
        target_code: target?.code ?? null,
        target_type: target?.type ?? null,
      };
    }),
  };
}

/** Tile meta counts for the Settings hub (Figma 12-Settings-Home). */
export async function fetchSettingsHubCounts(): Promise<SettingsHubCounts> {
  await requireRequestsManage();
  const supabase = await createClient();

  const [workflowTypes, activeTypes, assets, departments, esignCategories] =
    await Promise.all([
      supabase.from("request_approval_step_templates").select("request_type"),
      (supabase as any)
        .from("request_type_screenshot_policy")
        .select("request_type", { count: "exact", head: true })
        .eq("is_active", true),
      supabase
        .from("asset_catalog")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
      (supabase as any)
        .from("request_departments")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
      supabase
        .from("esign_categories")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
    ]);

  const distinctWorkflows = new Set(
    (workflowTypes.data ?? []).map((row) => String(row.request_type)),
  );
  return {
    workflows: distinctWorkflows.size,
    types: activeTypes.count ?? 0,
    assets: assets.count ?? 0,
    departments: departments.count ?? 0,
    // The two grantable access levels the Roles panel exposes (view_only, approver).
    // Not derived from request_staff_access — that table holds grants, not roles.
    roles: GRANTABLE_ACCESS_LEVELS.length,
    esignCategories: esignCategories.count ?? 0,
  };
}

/** Appointments card on the Reports page (Figma 09-Reports). */
export async function fetchAppointmentStatusCounts(): Promise<AppointmentStatusCounts> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data } = await supabase.from("appointments").select("status");

  const counts: AppointmentStatusCounts = { accepted: 0, pending: 0, rejected: 0 };
  for (const row of data ?? []) {
    if (row.status === "accepted") counts.accepted += 1;
    else if (row.status === "pending" || row.status === "reschedule_requested") counts.pending += 1;
    else if (row.status === "rejected") counts.rejected += 1;
  }
  return counts;
}

/** Department breakdown on the Reports page (Figma 09-Reports), derived from approval steps. */
export async function fetchRequestDepartmentReport(bounds: {
  from: string | null;
  to: string | null;
}): Promise<{ rows: RequestDepartmentReportRow[]; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  // The RPC ships in 20260828140000 and is not in the generated Database type yet.
  const client = supabase as unknown as {
    rpc(
      fn: "admin_request_department_report",
      args: { p_date_from: string | null; p_date_to: string | null },
    ): Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc("admin_request_department_report", {
    p_date_from: bounds.from,
    p_date_to: bounds.to,
  });

  if (error) return { rows: [], error: error.message };
  const result = asRecord(data);
  if (result.ok === false) return { rows: [], error: String(result.error ?? "failed") };

  const rows = Array.isArray(result.rows) ? (result.rows as Record<string, unknown>[]) : [];
  return {
    rows: rows.map((row) => ({
      department_key: String(row.department_key),
      department_label: String(row.department_label),
      requests: Number(row.requests ?? 0),
      approved: Number(row.approved ?? 0),
      rejected: Number(row.rejected ?? 0),
      avg_step_seconds: row.avg_step_seconds == null ? null : Number(row.avg_step_seconds),
    })),
  };
}

/** profile_id → department label for the Roles table DEPARTMENT column. */
export async function fetchStaffDepartments(): Promise<StaffDepartmentMap> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { data } = await (supabase as any)
    .from("request_department_members")
    .select("profile_id, request_departments(label_en)")
    .eq("is_active", true);

  const map: StaffDepartmentMap = {};
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const label = asRecord(row.request_departments).label_en;
    const profileId = String(row.profile_id);
    if (label && !map[profileId]) map[profileId] = String(label);
  }
  return map;
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
  departments: StaffDepartmentMap;
  error?: string;
}> {
  const [accessResult, staff, departments] = await Promise.all([
    fetchStaffAccess(),
    fetchStaffProfileOptions(),
    fetchStaffDepartments(),
  ]);
  return {
    staffOptions: staff,
    rows: accessResult.rows,
    departments,
    error: accessResult.error,
  };
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

export async function updateDepartmentMemberRole(
  id: string,
  role_title: DepartmentRoleTitle,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const supabase = await createClient();
  const { error } = await (supabase as any)
    .from("request_department_members")
    .update({ role_title, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAdminMutation({
    action: "update",
    entityType: "request_department_members",
    entityId: id,
    routeName: "requests.settings.departments.updateMemberRole",
    context: { role_title },
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
