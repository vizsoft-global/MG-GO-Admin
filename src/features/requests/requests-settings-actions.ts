"use server";

import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";
import { callAdminFunction } from "@/lib/firebase/callable";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import {
  describeRequestsAudit,
  isRequestsListScan,
  type RequestsAuditDetail,
} from "./request-audit-summary";
import type {
  AccessLevel,
  AppointmentStatusCounts,
  ComplaintCategoryRow,
  DepartmentMemberRow,
  DepartmentRoleTitle,
  DepartmentRow,
  LoanTenureOptionRow,
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
const COMPLAINT_CATEGORIES = "complaint_categories";
const LOAN_TENURE_OPTIONS = "loan_tenure_options";
const DEPARTMENT_MEMBERS = "request_department_members";
const APPOINTMENTS = "appointments";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DocRow = Record<string, unknown> & { id: string };

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

function cell(value: unknown): unknown {
  if (value == null) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (Array.isArray(value)) return value.map(cell);
  return value;
}

function docRow(id: string, data: DocumentData | undefined): DocRow | null {
  if (!data) return null;
  const row: DocRow = { id };
  for (const [key, value] of Object.entries(data)) row[key] = cell(value);
  return row;
}

async function openDb(): Promise<Firestore | null> {
  return staffDb();
}

async function listDocs(name: string): Promise<{ rows: DocRow[]; error: string | null }> {
  const db = await openDb();
  if (!db) return { rows: [], error: "not_configured" };
  try {
    const snap = await db.collection(name).get();
    return { rows: snap.docs.map((doc) => docRow(doc.id, doc.data())!), error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "read_failed" };
  }
}

async function queryDocs(
  name: string,
  filters: Array<[string, unknown]>,
): Promise<{ rows: DocRow[]; error: string | null }> {
  const db = await openDb();
  if (!db) return { rows: [], error: "not_configured" };
  try {
    let q: Query = db.collection(name);
    for (const [field, value] of filters) q = q.where(field, "==", value);
    const snap = await q.get();
    return { rows: snap.docs.map((doc) => docRow(doc.id, doc.data())!), error: null };
  } catch {
    const all = await listDocs(name);
    if (all.error) return all;
    return {
      rows: all.rows.filter((row) => filters.every(([field, value]) => row[field] === value)),
      error: null,
    };
  }
}

async function docsByIds(name: string, ids: string[]): Promise<DocRow[]> {
  const db = await openDb();
  if (!db) return [];
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  const out: DocRow[] = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snaps = await db.getAll(...chunk.map((id) => db.collection(name).doc(id)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const row = docRow(snap.id, snap.data());
      if (row) out.push(row);
    }
  }
  return out;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function sortRows(rows: DocRow[], keys: Array<[string, "asc" | "desc"]>): DocRow[] {
  return [...rows].sort((left, right) => {
    for (const [key, dir] of keys) {
      const c = compareValues(left[key], right[key]);
      if (c !== 0) return dir === "asc" ? c : -c;
    }
    return 0;
  });
}

async function countDocs(
  name: string,
  filters: Array<[string, unknown]>,
): Promise<{ count: number; error: string | null }> {
  const db = await openDb();
  if (!db) return { count: 0, error: "not_configured" };
  try {
    let q: Query = db.collection(name);
    for (const [field, value] of filters) q = q.where(field, "==", value);
    const snap = await q.count().get();
    return { count: snap.data().count, error: null };
  } catch {
    const listed = await queryDocs(name, filters);
    return { count: listed.rows.length, error: listed.error };
  }
}

async function patchDoc(
  name: string,
  id: string,
  data: Record<string, unknown>,
): Promise<string | null> {
  const db = await openDb();
  if (!db) return "not_configured";
  try {
    const ref = db.collection(name).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    await ref.set(data, { merge: true });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "write_failed";
  }
}

async function insertDoc(
  name: string,
  data: Record<string, unknown>,
): Promise<{ id?: string; error?: string }> {
  const db = await openDb();
  if (!db) return { error: "not_configured" };
  const id = crypto.randomUUID();
  try {
    await db.collection(name).doc(id).set({ ...data, id });
    return { id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "write_failed" };
  }
}

async function deleteDoc(name: string, id: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return "not_configured";
  try {
    await db.collection(name).doc(id).delete();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "delete_failed";
  }
}

async function deleteWhere(
  name: string,
  filters: Array<[string, unknown]>,
): Promise<string | null> {
  const listed = await queryDocs(name, filters);
  if (listed.error) return listed.error;
  const db = await openDb();
  if (!db) return "not_configured";
  try {
    const batch = db.batch();
    for (const row of listed.rows) batch.delete(db.collection(name).doc(row.id));
    if (listed.rows.length > 0) await batch.commit();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "delete_failed";
  }
}

async function upsertBy(
  name: string,
  filters: Array<[string, unknown]>,
  data: Record<string, unknown>,
): Promise<{ id?: string; error?: string }> {
  const listed = await queryDocs(name, filters);
  if (listed.error) return { error: listed.error };
  const existing = listed.rows[0];
  if (existing) {
    const error = await patchDoc(name, existing.id, data);
    return error ? { error } : { id: existing.id };
  }
  return insertDoc(name, data);
}

async function takenBy(
  name: string,
  field: string,
  value: unknown,
  exceptId?: string,
): Promise<boolean> {
  const listed = await queryDocs(name, [[field, value]]);
  return listed.rows.some((row) => row.id !== exceptId);
}

async function findByKey(name: string, key: string): Promise<{ row: DocRow | null; error: string | null }> {
  const db = await openDb();
  if (!db) return { row: null, error: "not_configured" };
  try {
    const direct = await db.collection(name).doc(key).get();
    if (direct.exists) return { row: docRow(direct.id, direct.data()), error: null };
    const snap = await db.collection(name).where("key", "==", key).limit(1).get();
    const doc = snap.docs[0];
    return { row: doc ? docRow(doc.id, doc.data()) : null, error: null };
  } catch (e) {
    return { row: null, error: e instanceof Error ? e.message : "read_failed" };
  }
}

export async function fetchStepTemplates(requestType: RequestTypeSlug): Promise<{
  steps: StepTemplateRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const listed = await queryDocs(COLLECTIONS.requestApprovalStepTemplates, [
    ["request_type", requestType],
  ]);
  if (listed.error) return { steps: [], error: listed.error };

  await logAdminRead("requests", "requests.settings.workflows.list", {
    requestType,
  });

  return {
    steps: sortRows(listed.rows, [["step_order", "asc"]]).map((row) => ({
      id: row.id,
      step_order: Number(row.step_order),
      step_name: String(row.step_name ?? ""),
      role_key: String(row.role_key ?? ""),
      is_system_auto: Boolean(row.is_system_auto),
      allowed_actions: Array.isArray(row.allowed_actions) ? row.allowed_actions.map(String) : [],
      sla_minutes: row.sla_minutes == null ? null : Number(row.sla_minutes),
      breach_action:
        row.breach_action === "notify" || row.breach_action === "escalate"
          ? row.breach_action
          : null,
    })),
  };
}

export async function upsertStepTemplates(
  requestType: RequestTypeSlug,
  steps: StepTemplateRow[],
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();

  const payload = steps.map((step) => ({
    step_order: step.step_order,
    step_name: step.step_name.trim(),
    role_key: step.role_key.trim(),
    is_system_auto: step.is_system_auto,
    allowed_actions: step.is_system_auto ? [] : step.allowed_actions,
    sla_minutes: step.is_system_auto ? null : step.sla_minutes,
    breach_action: step.is_system_auto ? null : step.breach_action,
  }));

  const { data, error } = await callAdminFunction("admin_upsert_step_template", {
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
  const listed = await listDocs(COMPLAINT_CATEGORIES);
  if (listed.error) return { rows: [], error: listed.error };

  await logAdminRead("requests", "requests.settings.categories.list", {});

  return {
    rows: sortRows(listed.rows, [
      ["sort_order", "asc"],
      ["label_en", "asc"],
    ]).map((row) => ({
      id: row.id,
      key: String(row.key ?? ""),
      label_en: String(row.label_en ?? ""),
      label_ar: row.label_ar != null ? String(row.label_ar) : null,
      is_active: Boolean(row.is_active),
      sort_order: Number(row.sort_order ?? 0),
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
  const key = input.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const label_en = input.label_en.trim();
  if (!key || !label_en) return { ok: false, error: "missing_fields" };

  if (await takenBy(COMPLAINT_CATEGORIES, "key", key, input.id)) {
    return { ok: false, error: "key_exists" };
  }

  const row = {
    key,
    label_en,
    label_ar: input.label_ar?.trim() || null,
    is_active: input.is_active ?? true,
    sort_order: input.sort_order ?? 0,
    updated_at: new Date(),
  };

  if (input.id) {
    const error = await patchDoc(COMPLAINT_CATEGORIES, input.id, row);
    if (error) return { ok: false, error };
    await logAdminMutation({
      action: "update",
      entityType: "complaint_categories",
      entityId: input.id,
      routeName: "requests.settings.categories.update",
    });
    return { ok: true, id: input.id };
  }

  const created = await insertDoc(COMPLAINT_CATEGORIES, row);
  if (created.error || !created.id) return { ok: false, error: created.error ?? "write_failed" };

  await logAdminMutation({
    action: "create",
    entityType: "complaint_categories",
    entityId: created.id,
    routeName: "requests.settings.categories.create",
  });
  return { ok: true, id: created.id };
}

export async function deleteComplaintCategory(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const error = await deleteDoc(COMPLAINT_CATEGORIES, id);
  if (error) return { ok: false, error };

  await logAdminMutation({
    action: "delete",
    entityType: "complaint_categories",
    entityId: id,
    routeName: "requests.settings.categories.delete",
  });
  return { ok: true };
}

export async function fetchLoanTenureOptions(): Promise<{
  rows: LoanTenureOptionRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const listed = await listDocs(LOAN_TENURE_OPTIONS);
  if (listed.error) return { rows: [], error: listed.error };

  await logAdminRead("requests", "requests.settings.tenure.list", {});

  return {
    rows: sortRows(listed.rows, [
      ["sort_order", "asc"],
      ["months", "asc"],
    ]).map((row) => ({
      id: row.id,
      months: Number(row.months),
      label: row.label != null ? String(row.label) : null,
      is_active: Boolean(row.is_active),
      sort_order: Number(row.sort_order ?? 0),
    })),
  };
}

export async function upsertLoanTenureOption(input: {
  id?: string;
  months: number;
  label?: string | null;
  is_active?: boolean;
  sort_order?: number;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireRequestsManage();
  const months = Math.trunc(input.months);
  if (!Number.isFinite(months) || months <= 0) return { ok: false, error: "invalid_months" };

  if (await takenBy(LOAN_TENURE_OPTIONS, "months", months, input.id)) {
    return { ok: false, error: "key_exists" };
  }

  const row = {
    months,
    label: input.label?.trim() || `${months} months`,
    is_active: input.is_active ?? true,
    sort_order: input.sort_order ?? months,
    updated_at: new Date(),
  };

  if (input.id) {
    const error = await patchDoc(LOAN_TENURE_OPTIONS, input.id, row);
    if (error) return { ok: false, error };
    await logAdminMutation({
      action: "update",
      entityType: "loan_tenure_options",
      entityId: input.id,
      routeName: "requests.settings.tenure.update",
    });
    return { ok: true, id: input.id };
  }

  const created = await insertDoc(LOAN_TENURE_OPTIONS, row);
  if (created.error || !created.id) return { ok: false, error: created.error ?? "write_failed" };

  await logAdminMutation({
    action: "create",
    entityType: "loan_tenure_options",
    entityId: created.id,
    routeName: "requests.settings.tenure.create",
  });
  return { ok: true, id: created.id };
}

export async function deleteLoanTenureOption(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const error = await deleteDoc(LOAN_TENURE_OPTIONS, id);
  if (error) return { ok: false, error };

  await logAdminMutation({
    action: "delete",
    entityType: "loan_tenure_options",
    entityId: id,
    routeName: "requests.settings.tenure.delete",
  });
  return { ok: true };
}

export async function fetchStaffAccess(): Promise<{
  rows: StaffAccessRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const listed = await listDocs(COLLECTIONS.requestStaffAccess);
  if (listed.error) return { rows: [], error: listed.error };

  await logAdminRead("requests", "requests.settings.staff_access.list", {});

  const profiles = await docsByIds(
    COLLECTIONS.profiles,
    listed.rows.map((row) => String(row.profile_id ?? "")),
  );
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  return {
    rows: sortRows(listed.rows, [
      ["request_type", "asc"],
      ["created_at", "asc"],
    ]).map((row) => {
      const profile = profileById.get(String(row.profile_id ?? ""));
      return {
        id: row.id,
        profile_id: String(row.profile_id ?? ""),
        profile_name: String(profile?.full_name ?? "—"),
        profile_email: profile?.email != null ? String(profile.email) : null,
        request_type: String(row.request_type),
        access_level: row.access_level as "view_only" | "approver",
      };
    }),
  };
}

export async function fetchStaffProfileOptions(): Promise<StaffProfileOption[]> {
  await requireRequestsManage();
  const listed = await queryDocs(COLLECTIONS.profiles, [
    ["role", "staff"],
    ["approval_status", "approved"],
  ]);
  return sortRows(listed.rows, [["full_name", "asc"]]).map((row) => ({
    id: row.id,
    full_name: row.full_name != null ? String(row.full_name) : "—",
    email: row.email != null ? String(row.email) : null,
  }));
}

export async function upsertStaffAccess(input: {
  id?: string;
  profile_id: string;
  request_type: RequestTypeSlug;
  access_level: "view_only" | "approver";
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  await requireRequestsManage();
  const row = {
    profile_id: input.profile_id,
    request_type: input.request_type,
    access_level: input.access_level,
    updated_at: new Date(),
  };

  if (input.id) {
    const error = await patchDoc(COLLECTIONS.requestStaffAccess, input.id, row);
    if (error) return { ok: false, error };
    await logAdminMutation({
      action: "update",
      entityType: "request_staff_access",
      entityId: input.id,
      routeName: "requests.settings.staff_access.update",
    });
    return { ok: true, id: input.id };
  }

  const saved = await upsertBy(
    COLLECTIONS.requestStaffAccess,
    [
      ["profile_id", input.profile_id],
      ["request_type", input.request_type],
    ],
    row,
  );
  if (saved.error || !saved.id) return { ok: false, error: saved.error ?? "write_failed" };

  await logAdminMutation({
    action: "create",
    entityType: "request_staff_access",
    entityId: saved.id,
    routeName: "requests.settings.staff_access.create",
  });
  return { ok: true, id: saved.id };
}

export async function deleteStaffAccess(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const error = await deleteDoc(COLLECTIONS.requestStaffAccess, id);
  if (error) return { ok: false, error };

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
  /** Structured DETAILS — the panel translates this so a preset never leaks through. */
  detail: RequestsAuditDetail;
  /** RCM-#### code of the request the row is about, when it can be resolved. */
  target_code: string | null;
  target_type: string | null;
};

export async function fetchRequestsAuditLogs(): Promise<{
  rows: RequestsAuditLogRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const listed = await queryDocs(COLLECTIONS.adminActivityLogs, [["entity_type", "requests"]]);
  if (listed.error) return { rows: [], error: listed.error };

  // Two rows can share a created_at. id breaks the tie so the sequence stays stable.
  const data = sortRows(listed.rows, [
    ["created_at", "desc"],
    ["id", "desc"],
  ]).slice(0, 400);

  const actorIds = Array.from(
    new Set(data.map((row) => row.admin_user_id).filter((id): id is string => typeof id === "string" && id.length > 0)),
  );
  const nameById = new Map<string, string>();
  if (actorIds.length > 0) {
    const profiles = await docsByIds(COLLECTIONS.profiles, actorIds);
    for (const profile of profiles) {
      if (typeof profile.full_name === "string" && profile.full_name) {
        nameById.set(profile.id, profile.full_name);
      }
    }
  }

  const requestIds = Array.from(
    new Set(
      data
        .flatMap((row) => [row.entity_id, asRecord(row.context).requestId])
        .filter((id): id is string => typeof id === "string" && UUID_RE.test(id)),
    ),
  );
  const requestById = new Map<string, { code: string | null; type: string | null }>();
  if (requestIds.length > 0) {
    const requests = await docsByIds(COLLECTIONS.requests, requestIds);
    for (const request of requests) {
      requestById.set(request.id, {
        code: request.request_code != null ? String(request.request_code) : null,
        type: request.request_type != null ? String(request.request_type) : null,
      });
    }
  }

  return {
    rows: data
      .filter((row) => !isRequestsListScan(row.route_name != null ? String(row.route_name) : null))
      .map((row) => {
        const contextRequestId = asRecord(row.context).requestId;
        const entityId = row.entity_id != null ? String(row.entity_id) : null;
        const target =
          requestById.get(entityId ?? "") ??
          (typeof contextRequestId === "string" ? requestById.get(contextRequestId) : undefined);
        const actorId = typeof row.admin_user_id === "string" ? row.admin_user_id : null;
        return {
          id: row.id,
          action: String(row.action ?? ""),
          route_name: row.route_name != null ? String(row.route_name) : null,
          entity_id: entityId,
          created_at: row.created_at != null ? String(row.created_at) : "",
          actor_id: actorId,
          actor_name: actorId ? (nameById.get(actorId) ?? "—") : "System",
          actor_role: row.admin_role_slug != null ? String(row.admin_role_slug) : null,
          detail: describeRequestsAudit({
            routeName: row.route_name != null ? String(row.route_name) : null,
            context: row.context,
            changedFields: row.changed_fields,
            errorMessage: row.error_message != null ? String(row.error_message) : null,
            targetCode: target?.code ?? null,
            targetType: target?.type ?? null,
          }),
          target_code: target?.code ?? null,
          target_type: target?.type ?? null,
        };
      }),
  };
}

/** Tile meta counts for the Settings hub (Figma 12-Settings-Home). */
export async function fetchSettingsHubCounts(): Promise<SettingsHubCounts> {
  await requireRequestsManage();

  const [workflowTypes, activeTypes, assets, departments, esignCategories] = await Promise.all([
    listDocs(COLLECTIONS.requestApprovalStepTemplates),
    countDocs(COLLECTIONS.requestTypeDefinitions, [["is_active", true]]),
    countDocs(COLLECTIONS.assetCatalog, [["is_active", true]]),
    countDocs(COLLECTIONS.requestDepartments, [["is_active", true]]),
    countDocs(COLLECTIONS.esignCategories, [["is_active", true]]),
  ]);

  const distinctWorkflows = new Set(workflowTypes.rows.map((row) => String(row.request_type)));
  return {
    workflows: distinctWorkflows.size,
    types: activeTypes.count,
    assets: assets.count,
    departments: departments.count,
    // The two grantable access levels the Roles panel exposes (view_only, approver).
    // Not derived from request_staff_access — that table holds grants, not roles.
    roles: GRANTABLE_ACCESS_LEVELS.length,
    esignCategories: esignCategories.count,
  };
}

/** Appointments card on the Reports page (Figma 09-Reports). */
export async function fetchAppointmentStatusCounts(): Promise<AppointmentStatusCounts> {
  await requireRequestsManage();
  const listed = await listDocs(APPOINTMENTS);

  const counts: AppointmentStatusCounts = { accepted: 0, pending: 0, rejected: 0 };
  for (const row of listed.rows) {
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
  const { data, error } = await callAdminFunction("admin_request_department_report", {
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
  const listed = await queryDocs(DEPARTMENT_MEMBERS, [["is_active", true]]);
  const departments = await docsByIds(
    COLLECTIONS.requestDepartments,
    listed.rows.map((row) => String(row.department_id ?? "")),
  );
  const labelById = new Map(
    departments.map((row) => [row.id, row.label_en != null ? String(row.label_en) : ""]),
  );

  const map: StaffDepartmentMap = {};
  for (const row of sortRows(listed.rows, [["created_at", "asc"]])) {
    const label = labelById.get(String(row.department_id ?? ""));
    const profileId = String(row.profile_id ?? "");
    if (label && !map[profileId]) map[profileId] = label;
  }
  return map;
}

export async function fetchRequestTypeScreenshotPolicy(): Promise<{
  rows: RequestTypeScreenshotPolicyRow[];
  error?: string;
}> {
  await requireRequestsManage();
  const listed = await listDocs(COLLECTIONS.requestTypeDefinitions);
  if (listed.error) return { rows: [], error: listed.error };
  return {
    rows: sortRows(listed.rows, [["sort_order", "asc"]]).map((row) => ({
      request_type: String(row.key ?? row.id) as RequestTypeSlug,
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
  const found = await findByKey(COLLECTIONS.requestTypeDefinitions, requestType);
  if (found.error) return { ok: false, error: found.error };
  if (found.row) {
    const error = await patchDoc(COLLECTIONS.requestTypeDefinitions, found.row.id, {
      ...patch,
      updated_at: new Date(),
    });
    if (error) return { ok: false, error };
  }

  await logAdminMutation({
    action: "update",
    entityType: "request_type_definitions",
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
  const [listed, members] = await Promise.all([
    listDocs(COLLECTIONS.requestDepartments),
    listDocs(DEPARTMENT_MEMBERS),
  ]);
  const error = listed.error ?? members.error;
  if (error) return { rows: [], error };

  await logAdminRead("requests", "requests.settings.departments.list", {});

  const counts = new Map<string, number>();
  for (const member of members.rows) {
    const departmentId = String(member.department_id ?? "");
    counts.set(departmentId, (counts.get(departmentId) ?? 0) + 1);
  }

  return {
    rows: sortRows(listed.rows, [
      ["sort_order", "asc"],
      ["label_en", "asc"],
    ]).map((row) => ({
      id: row.id,
      key: String(row.key ?? ""),
      label_en: String(row.label_en ?? ""),
      label_ar: row.label_ar != null ? String(row.label_ar) : null,
      is_active: Boolean(row.is_active),
      sort_order: Number(row.sort_order ?? 0),
      member_count: counts.get(row.id) ?? 0,
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
  const key = input.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const label_en = input.label_en.trim();
  if (!key || !label_en) return { ok: false, error: "missing_fields" };

  if (await takenBy(COLLECTIONS.requestDepartments, "key", key, input.id)) {
    return { ok: false, error: "key_exists" };
  }

  const row = {
    key,
    label_en,
    label_ar: input.label_ar?.trim() || null,
    updated_at: new Date(),
  };

  if (input.id) {
    const error = await patchDoc(COLLECTIONS.requestDepartments, input.id, row);
    if (error) return { ok: false, error };
    await logAdminMutation({
      action: "update",
      entityType: "request_departments",
      entityId: input.id,
      routeName: "requests.settings.departments.update",
    });
    return { ok: true, id: input.id };
  }

  const created = await insertDoc(COLLECTIONS.requestDepartments, row);
  if (created.error || !created.id) return { ok: false, error: created.error ?? "write_failed" };

  await logAdminMutation({
    action: "create",
    entityType: "request_departments",
    entityId: created.id,
    routeName: "requests.settings.departments.create",
  });
  return { ok: true, id: created.id };
}

export async function deleteDepartment(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsManage();
  const error = await deleteDoc(COLLECTIONS.requestDepartments, id);
  if (error) return { ok: false, error };

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
  const listed = await queryDocs(DEPARTMENT_MEMBERS, [["department_id", departmentId]]);
  if (listed.error) return { rows: [], error: listed.error };

  const profiles = await docsByIds(
    COLLECTIONS.profiles,
    listed.rows.map((row) => String(row.profile_id ?? "")),
  );
  const profileById = new Map(profiles.map((row) => [row.id, row]));

  return {
    rows: sortRows(listed.rows, [["created_at", "asc"]]).map((row) => {
      const profile = profileById.get(String(row.profile_id ?? ""));
      return {
        id: row.id,
        department_id: String(row.department_id ?? ""),
        profile_id: String(row.profile_id ?? ""),
        profile_name: String(profile?.full_name ?? "—"),
        profile_email: profile?.email != null ? String(profile.email) : null,
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
  const saved = await upsertBy(
    DEPARTMENT_MEMBERS,
    [
      ["department_id", input.department_id],
      ["profile_id", input.profile_id],
    ],
    {
      department_id: input.department_id,
      profile_id: input.profile_id,
      role_title: input.role_title,
      updated_at: new Date(),
    },
  );
  if (saved.error) return { ok: false, error: saved.error };

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
  const error = await patchDoc(DEPARTMENT_MEMBERS, id, {
    is_active,
    updated_at: new Date(),
  });
  if (error) return { ok: false, error };

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
  const error = await patchDoc(DEPARTMENT_MEMBERS, id, {
    role_title,
    updated_at: new Date(),
  });
  if (error) return { ok: false, error };

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
  const error = await deleteDoc(DEPARTMENT_MEMBERS, id);
  if (error) return { ok: false, error };

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

  for (const [requestType, level] of Object.entries(grants) as [RequestTypeSlug, AccessLevel][]) {
    if (!level || level === "none") {
      const error = await deleteWhere(COLLECTIONS.requestStaffAccess, [
        ["profile_id", profileId],
        ["request_type", requestType],
      ]);
      if (error) return { ok: false, error };
      continue;
    }
    const saved = await upsertBy(
      COLLECTIONS.requestStaffAccess,
      [
        ["profile_id", profileId],
        ["request_type", requestType],
      ],
      {
        profile_id: profileId,
        request_type: requestType,
        access_level: level,
        updated_at: new Date(),
      },
    );
    if (saved.error) return { ok: false, error: saved.error };
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
