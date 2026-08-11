"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import type {
  RequestApprovalStep,
  RequestAttachment,
  RequestClarification,
  RequestDatePreset,
  RequestDetail,
  RequestKpis,
  RequestListFilters,
  RequestListRow,
} from "./types";

const KUWAIT_TZ = "Asia/Kuwait";

function kuwaitDateParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KUWAIT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return { y, m, day };
}

/** Inclusive Kuwait calendar window → UTC bounds for created_at filter. */
export function datePresetToBounds(preset: RequestDatePreset): {
  from: string | null;
  to: string | null;
} {
  if (preset === "all") return { from: null, to: null };
  const { y, m, day } = kuwaitDateParts();
  const startOfDay = (yy: number, mm: number, dd: number) =>
    new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0) - 3 * 3600 * 1000);
  // Kuwait is UTC+3; approximate day bounds via offset
  const addDays = (base: Date, n: number) =>
    new Date(base.getTime() + n * 24 * 3600 * 1000);

  if (preset === "today") {
    const from = startOfDay(y, m, day);
    return { from: from.toISOString(), to: addDays(from, 1).toISOString() };
  }
  if (preset === "this_week") {
    const today = startOfDay(y, m, day);
    const dow = new Date(
      Date.UTC(y, m - 1, day, 12, 0, 0),
    ).getUTCDay(); // 0 Sun
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const from = addDays(today, mondayOffset);
    return { from: from.toISOString(), to: addDays(from, 7).toISOString() };
  }
  if (preset === "this_month") {
    const from = startOfDay(y, m, 1);
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    return {
      from: from.toISOString(),
      to: startOfDay(nextY, nextM, 1).toISOString(),
    };
  }
  // last_month
  const lm = m === 1 ? 12 : m - 1;
  const ly = m === 1 ? y - 1 : y;
  const from = startOfDay(ly, lm, 1);
  return { from: from.toISOString(), to: startOfDay(y, m, 1).toISOString() };
}

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

export async function fetchAdminRequestsList(filters: RequestListFilters): Promise<{
  rows: RequestListRow[];
  kpi: RequestKpis;
  error?: string;
}> {
  await requireRequestsView();
  const supabase = await createClient();
  const { from, to } = datePresetToBounds(filters.datePreset);

  const { data, error } = await supabase.rpc("admin_list_requests", {
    p_date_from: from,
    p_date_to: to,
    p_status: filters.status || undefined,
    p_type: filters.type || undefined,
    p_search: filters.search?.trim() || undefined,
    p_limit: filters.limit ?? 50,
    p_offset: filters.offset ?? 0,
  });

  if (error) {
    return {
      rows: [],
      kpi: emptyKpi(),
      error: error.message,
    };
  }

  const payload = asRecord(data);
  if (payload.ok === false) {
    return { rows: [], kpi: emptyKpi(), error: String(payload.error ?? "failed") };
  }

  const kpiRaw = asRecord(payload.kpi);
  const rowsRaw = Array.isArray(payload.rows) ? payload.rows : [];

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
        amount_kwd: r.amount_kwd != null ? Number(r.amount_kwd) : null,
        needs_attention: Boolean(r.needs_attention),
        attention_at: r.attention_at != null ? String(r.attention_at) : null,
        created_at: String(r.created_at ?? ""),
        severity: r.severity != null ? String(r.severity) : null,
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
        created_at: String(row.created_at ?? ""),
      };
    }),
  };
}

export async function decideAdminRequest(input: {
  requestId: string;
  action: string;
  reason?: string;
}): Promise<{ ok: boolean; error?: string; status?: string }> {
  await requireRequestsDecide();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_decide_request", {
    p_request_id: input.requestId,
    p_action: input.action,
    p_reason: input.reason ?? undefined,
    p_meta: {},
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
    routeName: "requests.decide",
    context: { decideAction: input.action, status: payload.status },
  });

  return { ok: true, status: payload.status != null ? String(payload.status) : undefined };
}
