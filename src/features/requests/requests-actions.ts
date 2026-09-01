"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { datePresetToBounds } from "./date-presets";
import { isNeededByInPast } from "./request-create-utils";
import { FUEL_TRANSFER_TYPES } from "./types";
import type {
  FuelTransferType,
  RequestApprovalStep,
  RequestAttachment,
  RequestClarification,
  RequestCreateInput,
  RequestCreateOptions,
  RequestDecisionAttachment,
  RequestDecisionTerms,
  RequestDepartmentOption,
  RequestDetail,
  RequestKpis,
  RequestListFilters,
  RequestListRow,
  RequestRescheduleInput,
} from "./types";

async function requireRequestsView() {
  const session = await getSessionUser();
  if (
    !session ||
    !hasPermissionInSet(session.permissions, "requests.view", session.isSuperAdmin)
  ) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireRequestsManage() {
  const session = await requireRequestsView();
  if (!hasPermissionInSet(session.permissions, "requests.manage", session.isSuperAdmin)) {
    throw new Error("not_authorized");
  }
  return session;
}

async function requireRequestsDecide() {
  const session = await requireRequestsView();
  if (
    !hasPermissionInSet(session.permissions, "requests.manage", session.isSuperAdmin) &&
    !hasPermissionInSet(session.permissions, "requests.approve", session.isSuperAdmin)
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

export async function fetchRequestTypeCounts(): Promise<{
  counts: Record<string, { total: number; pending: number }>;
  error?: string;
}> {
  await requireRequestsView();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_count_requests_by_type");

  if (error) return { counts: {}, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) {
    return { counts: {}, error: String(payload.error ?? "failed") };
  }

  const raw = asRecord(payload.counts);
  const counts: Record<string, { total: number; pending: number }> = {};
  for (const [type, value] of Object.entries(raw)) {
    const v = asRecord(value);
    counts[type] = { total: Number(v.total ?? 0), pending: Number(v.pending ?? 0) };
  }
  return { counts };
}

export async function fetchAdminRequestsList(filters: RequestListFilters): Promise<{
  rows: RequestListRow[];
  kpi: RequestKpis;
  filteredTotal: number;
  statusCounts: Record<string, number>;
  departmentOptions: RequestDepartmentOption[];
  error?: string;
}> {
  await requireRequestsView();
  const supabase = await createClient();
  const { from, to } = datePresetToBounds(filters.datePreset);

  const { data, error } = await supabase.rpc("admin_list_requests", {
    p_date_from: from ?? undefined,
    p_date_to: to ?? undefined,
    p_status: filters.status || undefined,
    p_type: filters.type || undefined,
    p_search: filters.search?.trim() || undefined,
    p_limit: filters.limit ?? 50,
    p_offset: filters.offset ?? 0,
    p_department_key: filters.departmentKey || undefined,
    p_zone_id: filters.zoneId || undefined,
  });

  if (error) {
    return {
      rows: [],
      kpi: emptyKpi(),
      filteredTotal: 0,
      statusCounts: {},
      departmentOptions: [],
      error: error.message,
    };
  }

  const payload = asRecord(data);
  if (payload.ok === false) {
    return {
      rows: [],
      kpi: emptyKpi(),
      filteredTotal: 0,
      statusCounts: {},
      departmentOptions: [],
      error: String(payload.error ?? "failed"),
    };
  }

  const kpiRaw = asRecord(payload.kpi);
  const rowsRaw = Array.isArray(payload.rows) ? payload.rows : [];
  const statusCountsRaw = asRecord(payload.status_counts);
  const statusCounts: Record<string, number> = {};
  for (const [key, value] of Object.entries(statusCountsRaw)) {
    statusCounts[key] = Number(value ?? 0);
  }
  const departmentOptions: RequestDepartmentOption[] = (
    Array.isArray(payload.department_options) ? payload.department_options : []
  ).map((option) => {
    const o = asRecord(option);
    return { key: String(o.key ?? ""), label: String(o.label ?? o.key ?? "") };
  });

  await logAdminRead("requests", "requests.list", {
    preset: filters.datePreset,
    count: rowsRaw.length,
  });

  return {
    rows: rowsRaw.map((row) => {
      const r = asRecord(row);
      return {
        id: String(r.id),
        request_code: String(r.request_code ?? ""),
        request_type: String(r.request_type ?? ""),
        status: String(r.status ?? ""),
        current_step_label:
          r.current_step_label != null ? String(r.current_step_label) : null,
        current_step_order:
          r.current_step_order != null ? Number(r.current_step_order) : null,
        driver_id: String(r.driver_id ?? ""),
        driver_name: String(r.driver_name ?? "—"),
        driver_code: String(r.driver_code ?? ""),
        driver_zone: r.driver_zone != null ? String(r.driver_zone) : null,
        amount_kwd: r.amount_kwd != null ? Number(r.amount_kwd) : null,
        needs_attention: Boolean(r.needs_attention),
        attention_at: r.attention_at != null ? String(r.attention_at) : null,
        created_at: String(r.created_at ?? ""),
        severity: r.severity != null ? String(r.severity) : null,
        awaiting_driver_ack: Boolean(r.awaiting_driver_ack),
        department_key: r.department_key != null ? String(r.department_key) : null,
        department_label:
          r.department_label != null ? String(r.department_label) : null,
      };
    }),
    kpi: {
      total: Number(kpiRaw.total ?? 0),
      pending: Number(kpiRaw.pending ?? 0),
      overdue: Number(kpiRaw.overdue ?? 0),
      avg_resolution_seconds:
        kpiRaw.avg_resolution_seconds != null
          ? Number(kpiRaw.avg_resolution_seconds)
          : null,
      prev_total: kpiRaw.prev_total != null ? Number(kpiRaw.prev_total) : null,
      prev_pending:
        kpiRaw.prev_pending != null ? Number(kpiRaw.prev_pending) : null,
      prev_overdue:
        kpiRaw.prev_overdue != null ? Number(kpiRaw.prev_overdue) : null,
      prev_avg_resolution_seconds:
        kpiRaw.prev_avg_resolution_seconds != null
          ? Number(kpiRaw.prev_avg_resolution_seconds)
          : null,
    },
    filteredTotal: Number(payload.filtered_total ?? rowsRaw.length),
    statusCounts,
    departmentOptions,
  };
}

function emptyKpi(): RequestKpis {
  return {
    total: 0,
    pending: 0,
    overdue: 0,
    avg_resolution_seconds: null,
    prev_total: null,
    prev_pending: null,
    prev_overdue: null,
    prev_avg_resolution_seconds: null,
  };
}

export async function fetchAdminRequestDetail(requestId: string): Promise<{
  request: RequestDetail | null;
  steps: RequestApprovalStep[];
  clarifications: RequestClarification[];
  attachments: RequestAttachment[];
  error?: string;
}> {
  await requireRequestsView();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_get_request", {
    p_request_id: requestId,
  });

  if (error) {
    return {
      request: null,
      steps: [],
      clarifications: [],
      attachments: [],
      error: error.message,
    };
  }

  const payload = asRecord(data);
  if (payload.ok === false) {
    return {
      request: null,
      steps: [],
      clarifications: [],
      attachments: [],
      error: String(payload.error ?? "failed"),
    };
  }

  const r = asRecord(payload.request);
  const requesterRaw = asRecord(payload.requester);
  await logAdminRead("requests", "requests.detail", { requestId });

  return {
    request: {
      id: String(r.id),
      request_code: String(r.request_code ?? ""),
      request_type: String(r.request_type ?? ""),
      status: String(r.status ?? ""),
      payload: asRecord(r.payload),
      current_step_label:
        r.current_step_label != null ? String(r.current_step_label) : null,
      current_step_order:
        r.current_step_order != null ? Number(r.current_step_order) : null,
      driver_id: String(r.driver_id ?? ""),
      requester:
        requesterRaw.name != null
          ? {
              name: String(requesterRaw.name),
              code: requesterRaw.code != null ? String(requesterRaw.code) : "",
              phone: requesterRaw.phone != null ? String(requesterRaw.phone) : null,
              zone: requesterRaw.zone != null ? String(requesterRaw.zone) : null,
            }
          : null,
      amount_kwd: r.amount_kwd != null ? Number(r.amount_kwd) : null,
      start_date: r.start_date != null ? String(r.start_date) : null,
      end_date: r.end_date != null ? String(r.end_date) : null,
      details: r.details != null ? String(r.details) : null,
      decision_reason:
        r.decision_reason != null ? String(r.decision_reason) : null,
      severity: r.severity != null ? String(r.severity) : null,
      needs_attention: Boolean(r.needs_attention),
      created_at: String(r.created_at ?? ""),
      completed_at: r.completed_at != null ? String(r.completed_at) : null,
      acknowledged_at: r.acknowledged_at != null ? String(r.acknowledged_at) : null,
      sla_due_at: r.sla_due_at != null ? String(r.sla_due_at) : null,
      closed_at: r.closed_at != null ? String(r.closed_at) : null,
      fuel_transfer_type: isFuelTransferType(r.fuel_transfer_type)
        ? r.fuel_transfer_type
        : null,
    },
    steps: (Array.isArray(payload.steps) ? payload.steps : []).map((step) => {
      const s = asRecord(step);
      return {
        id: String(s.id),
        step_order: Number(s.step_order ?? 0),
        step_name: String(s.step_name ?? ""),
        role_key: String(s.role_key ?? ""),
        status: String(s.status ?? ""),
        decided_by: s.decided_by != null ? String(s.decided_by) : null,
        decided_at: s.decided_at != null ? String(s.decided_at) : null,
        decision_note: s.decision_note != null ? String(s.decision_note) : null,
        allowed_actions: Array.isArray(s.allowed_actions)
          ? s.allowed_actions.map((a) => String(a))
          : [],
        meta: asRecord(s.meta),
        started_at: s.started_at != null ? String(s.started_at) : null,
        actor_display_name:
          s.actor_display_name != null ? String(s.actor_display_name) : null,
        sla_due_at: s.sla_due_at != null ? String(s.sla_due_at) : null,
        sla_breached_at: s.sla_breached_at != null ? String(s.sla_breached_at) : null,
        breach_action: s.breach_action != null ? String(s.breach_action) : null,
      };
    }),
    clarifications: (Array.isArray(payload.clarifications)
      ? payload.clarifications
      : []
    ).map((c) => {
      const row = asRecord(c);
      return {
        id: String(row.id),
        step_order: row.step_order != null ? Number(row.step_order) : null,
        asked_at: String(row.asked_at ?? ""),
        question: String(row.question ?? ""),
        answered_at: row.answered_at != null ? String(row.answered_at) : null,
        answer: row.answer != null ? String(row.answer) : null,
      };
    }),
    attachments: (Array.isArray(payload.attachments)
      ? payload.attachments
      : []
    ).map((a) => {
      const row = asRecord(a);
      return {
        id: String(row.id),
        storage_key: String(row.storage_key ?? ""),
        file_name: row.file_name != null ? String(row.file_name) : null,
        content_type: row.content_type != null ? String(row.content_type) : null,
        byte_size: row.byte_size != null ? Number(row.byte_size) : null,
        created_at: String(row.created_at ?? ""),
      };
    }),
  };
}

function isFuelTransferType(value: unknown): value is FuelTransferType {
  return (FUEL_TRANSFER_TYPES as readonly string[]).includes(String(value));
}

export async function fetchRequestAttachmentUrl(
  storageKey: string,
): Promise<{ url: string | null; error?: string }> {
  await requireRequestsView();
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("request-attachments")
    .createSignedUrl(storageKey, 300);

  if (error) return { url: null, error: error.message };
  return { url: data?.signedUrl ?? null };
}

function staffDisplayName(session: Awaited<ReturnType<typeof requireRequestsDecide>>): string | null {
  const profile = asRecord(session.profile);
  const name = profile.full_name != null ? String(profile.full_name).trim() : "";
  return name || session.email || null;
}

/**
 * Only keys the driver app reads are forwarded, so a blank field never
 * overwrites a previously agreed term with an empty value.
 */
function buildDecisionMeta(
  terms: RequestDecisionTerms | undefined,
  approvedBy: string | null,
): Record<string, string | number> {
  const meta: Record<string, string | number> = {};
  if (!terms) return meta;
  if (terms.approved_amount != null) meta.approved_amount = terms.approved_amount;
  if (terms.approved_tenure_months != null) {
    meta.approved_tenure_months = terms.approved_tenure_months;
  }
  if (terms.deduction_start_date) meta.deduction_start_date = terms.deduction_start_date;
  if (terms.penalty_amount != null) meta.penalty_amount = terms.penalty_amount;
  const document = terms.required_document?.trim();
  if (document) meta.required_document = document;
  if (Object.keys(meta).length > 0 && approvedBy) meta.approved_by = approvedBy;
  return meta;
}

const ATTACH_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const ATTACH_MAX_BYTES = 10 * 1024 * 1024;

function safeAttachmentName(name: string): string {
  const trimmed = name.trim().replace(/[/\\]/g, "_");
  return trimmed.slice(0, 180) || "attachment";
}

export async function uploadStaffRequestAttachments(input: {
  requestId: string;
  files: Array<{ name: string; type: string; base64: string }>;
}): Promise<{ ok: boolean; attachments?: RequestDecisionAttachment[]; error?: string }> {
  const session = await requireRequestsDecide();
  if (input.files.length === 0) return { ok: false, error: "attachment_required" };

  const supabase = await createClient();
  const attachments: RequestDecisionAttachment[] = [];

  for (const file of input.files) {
    const type = file.type || "application/octet-stream";
    if (!ATTACH_MIME.has(type)) return { ok: false, error: "invalid_attachment_type" };
    const bytes = Buffer.from(file.base64, "base64");
    if (bytes.length === 0 || bytes.length > ATTACH_MAX_BYTES) {
      return { ok: false, error: "invalid_attachment_size" };
    }
    const key = `${session.id}/${input.requestId}/${Date.now()}_${safeAttachmentName(file.name)}`;
    const { error } = await supabase.storage.from("request-attachments").upload(key, bytes, {
      contentType: type,
      upsert: false,
    });
    if (error) return { ok: false, error: error.message };
    attachments.push({
      storage_key: key,
      file_name: safeAttachmentName(file.name),
      content_type: type,
      byte_size: bytes.length,
    });
  }

  return { ok: true, attachments };
}

export async function decideAdminRequest(input: {
  requestId: string;
  action: string;
  reason?: string;
  terms?: RequestDecisionTerms;
  reschedule?: RequestRescheduleInput;
  attachments?: RequestDecisionAttachment[];
}): Promise<{ ok: boolean; error?: string; status?: string }> {
  const session = await requireRequestsDecide();
  const supabase = await createClient();
  const meta = {
    ...buildDecisionMeta(input.terms, staffDisplayName(session)),
    ...(input.reschedule?.new_start_date
      ? { new_start_date: input.reschedule.new_start_date }
      : {}),
    ...(input.reschedule?.new_end_date
      ? { new_end_date: input.reschedule.new_end_date }
      : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  };
  const { data, error } = await supabase.rpc("admin_decide_request", {
    p_request_id: input.requestId,
    p_action: input.action,
    p_reason: input.reason ?? undefined,
    p_meta: meta,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("fuel_transfer_type_required")) {
      return { ok: false, error: "fuel_transfer_type_required" };
    }
    if (message.includes("attachment_required")) {
      return { ok: false, error: "attachment_required" };
    }
    return { ok: false, error: error.message };
  }
  const payload = asRecord(data);
  if (payload.ok === false) {
    return { ok: false, error: String(payload.error ?? "failed") };
  }

  await logAdminMutation({
    action: "update",
    entityType: "requests",
    entityId: input.requestId,
    routeName: "requests.decide",
    context: { decideAction: input.action, status: payload.status },
  });

  return { ok: true, status: payload.status != null ? String(payload.status) : undefined };
}

/**
 * Bulk decide runs the same per-request RPC in a loop so the approval chain, permissions and
 * driver notifications behave exactly as they do for a single decision. Failures are reported
 * per request instead of aborting the batch.
 */
export async function decideAdminRequestsBulk(input: {
  requestIds: string[];
  action: "approve" | "reject";
  reason?: string;
}): Promise<{
  ok: boolean;
  succeeded: string[];
  failed: Array<{ requestId: string; error: string }>;
  error?: string;
}> {
  const session = await requireRequestsDecide();
  if (input.requestIds.length === 0) {
    return { ok: false, succeeded: [], failed: [], error: "no_requests" };
  }
  if (input.action === "reject" && !input.reason?.trim()) {
    return { ok: false, succeeded: [], failed: [], error: "reason_required" };
  }

  const supabase = await createClient();
  const succeeded: string[] = [];
  const failed: Array<{ requestId: string; error: string }> = [];

  for (const requestId of input.requestIds) {
    const { data, error } = await supabase.rpc("admin_decide_request", {
      p_request_id: requestId,
      p_action: input.action,
      p_reason: input.reason?.trim() || undefined,
      p_meta: buildDecisionMeta(undefined, staffDisplayName(session)),
    });
    const payload = asRecord(data);
    if (error) {
      failed.push({ requestId, error: error.message });
    } else if (payload.ok === false) {
      failed.push({ requestId, error: String(payload.error ?? "failed") });
    } else {
      succeeded.push(requestId);
    }
  }

  await logAdminMutation({
    action: "update",
    entityType: "requests",
    routeName: "requests.decide_bulk",
    context: {
      decideAction: input.action,
      requested: input.requestIds.length,
      succeeded: succeeded.length,
      failed: failed.length,
    },
  });

  return { ok: failed.length === 0, succeeded, failed };
}

/**
 * Riders, plus the two option tables the create form needs. `loan_tenure_options` and
 * `complaint_categories` are deliberately empty until the client confirms them, so the form
 * reads them instead of hardcoding values and shows an empty state when there are none.
 */
export async function fetchRequestCreateOptions(): Promise<
  RequestCreateOptions & { error?: string }
> {
  await requireRequestsManage();
  const supabase = await createClient();

  const [driversResult, tenuresResult, categoriesResult, typesResult, fieldsResult] =
    await Promise.all([
      supabase
        .from("drivers")
        .select("id, driver_code, employee_id, profiles(full_name, phone)")
        .is("archived_at", null)
        .order("driver_code"),
      supabase
        .from("loan_tenure_options")
        .select("months, label, is_active")
        .eq("is_active", true)
        .order("sort_order")
        .order("months"),
      supabase
        .from("complaint_categories")
        .select("key, label_en, is_active")
        .eq("is_active", true)
        .order("sort_order")
        .order("label_en"),
      supabase
        .from("request_type_definitions")
        .select(
          "key, label_en, label_ar, is_system, is_active, sort_order, date_range_required, min_attachments",
        )
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("request_field_definitions")
        .select(
          "type_key, field_key, label_en, label_ar, kind, target, is_required, sort_order, options_source, options",
        )
        .order("sort_order"),
    ]);

  const error =
    driversResult.error?.message ??
    tenuresResult.error?.message ??
    categoriesResult.error?.message ??
    typesResult.error?.message ??
    fieldsResult.error?.message;

  const types = (typesResult.data ?? []).map((row) => ({
    key: row.key,
    label_en: row.label_en,
    label_ar: row.label_ar,
    is_system: Boolean(row.is_system),
    date_range_required: Boolean(row.date_range_required),
    min_attachments: Number(row.min_attachments ?? 0),
  }));
  const typeKeys = new Set(types.map((row) => row.key));

  return {
    drivers: (driversResult.data ?? []).map((row) => {
      const profile = asRecord(row.profiles);
      return {
        id: row.id,
        full_name: String(profile.full_name ?? row.driver_code ?? "—"),
        driver_code: row.driver_code ?? "",
        employee_id: row.employee_id,
        phone: profile.phone != null ? String(profile.phone) : null,
      };
    }),
    loanTenures: (tenuresResult.data ?? []).map((row) => ({
      months: Number(row.months),
      label: row.label ?? `${row.months}`,
    })),
    complaintCategories: (categoriesResult.data ?? []).map((row) => ({
      key: row.key,
      label: row.label_en ?? row.key,
    })),
    types,
    fields: (fieldsResult.data ?? [])
      .filter((row) => typeKeys.has(String(row.type_key)))
      .map((row) => ({
        type_key: String(row.type_key),
        field_key: String(row.field_key),
        label_en: String(row.label_en ?? row.field_key),
        label_ar: row.label_ar != null ? String(row.label_ar) : null,
        kind: String(row.kind),
        target: String(row.target),
        is_required: Boolean(row.is_required),
        sort_order: Number(row.sort_order ?? 0),
        options_source: row.options_source != null ? String(row.options_source) : null,
        options: Array.isArray(row.options)
          ? row.options.filter((item): item is string => typeof item === "string")
          : [],
      })),
    ...(error ? { error } : {}),
  };
}

/**
 * Office staff raising a request for a rider who phoned in. `admin_create_request` mirrors
 * `driver_create_request` (code allocation, approval-step seeding, gated config checks) and
 * stamps `payload.created_on_behalf_by` so the audit trail keeps the two apart.
 */
export async function createRequestOnBehalf(input: RequestCreateInput): Promise<{
  ok: boolean;
  requestId?: string;
  requestCode?: string;
  error?: string;
}> {
  await requireRequestsManage();
  if (
    typeof input.payload.needed_by === "string" &&
    isNeededByInPast(input.payload.needed_by, kuwaitTodayYmd())
  ) {
    return { ok: false, error: "date_in_past" };
  }
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("admin_create_request", {
    p_driver_id: input.driverId,
    p_type: input.type as "leave",
    p_payload: input.payload,
    p_amount_kwd: input.amountKwd ?? undefined,
    p_start_date: input.startDate ?? undefined,
    p_end_date: input.endDate ?? undefined,
    p_severity: (input.severity as "low") ?? undefined,
    p_details: input.details ?? undefined,
  });

  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) {
    return { ok: false, error: String(payload.error ?? "failed") };
  }

  const requestId = payload.id != null ? String(payload.id) : undefined;
  await logAdminMutation({
    action: "create",
    entityType: "requests",
    entityId: requestId,
    routeName: "requests.createOnBehalf",
    context: { requestType: input.type, driverId: input.driverId },
  });

  return {
    ok: true,
    requestId,
    requestCode: payload.request_code != null ? String(payload.request_code) : undefined,
  };
}

/**
 * Payout method on a fuel reimbursement. Separate from the decide call because Accounts may
 * correct it after approval, and clearing it (`null`) has to stay possible.
 */
export async function setFuelTransferType(input: {
  requestId: string;
  transferType: FuelTransferType | null;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsDecide();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_fuel_transfer_type", {
    p_request_id: input.requestId,
    // The RPC folds an empty string back to NULL, which is how a choice is cleared.
    p_transfer_type: input.transferType ?? "",
  });

  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) {
    return { ok: false, error: String(payload.error ?? "failed") };
  }

  await logAdminMutation({
    action: "update",
    entityType: "requests",
    entityId: input.requestId,
    routeName: "requests.fuelTransferType",
    context: { transferType: input.transferType },
  });

  return { ok: true };
}

/** Edit path for requests already decided — merges into the last completed step. */
export async function saveRequestDecisionTerms(input: {
  requestId: string;
  terms: RequestDecisionTerms;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRequestsDecide();
  const meta = buildDecisionMeta(input.terms, staffDisplayName(session));
  if (Object.keys(meta).length === 0) return { ok: false, error: "no_terms" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_request_decision_meta", {
    p_request_id: input.requestId,
    p_meta: meta,
  });

  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) {
    return { ok: false, error: String(payload.error ?? "failed") };
  }

  await logAdminMutation({
    action: "update",
    entityType: "requests",
    entityId: input.requestId,
    routeName: "requests.decisionTerms",
    context: { terms: Object.keys(meta) },
  });

  return { ok: true };
}
