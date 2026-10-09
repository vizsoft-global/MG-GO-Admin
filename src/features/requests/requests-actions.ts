"use server";

import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";
import { callAdminFunction } from "@/lib/firebase/callable";
import { getFirebaseStorage } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/db";
import { staffDb } from "@/lib/firebase/staff-db";
import { getSessionUser } from "@/lib/auth/get-session";
import { hasPermissionInSet, type Permission } from "@/lib/auth/permissions";
import { logAdminMutation, logAdminRead } from "@/lib/audit/log-admin-activity";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { getPresignedGetUrl } from "@/lib/storage/r2-client";
import { isR2ObjectKey } from "@/lib/storage/r2-keys";
import { attachmentDisplayName } from "./attachment-display-name";
import { datePresetToBounds } from "./date-presets";
import { isNeededByInPast } from "./request-create-utils";
import {
  createKindSpecs,
  isKnownCreateKind,
  missingRequiredCreateKind,
} from "./request-create-kinds";
import { FUEL_TRANSFER_TYPES } from "./types";
import type {
  FuelTransferType,
  RequestApprovalStep,
  RequestAttachment,
  RequestClarification,
  RequestComment,
  RequestCreateInput,
  RequestCreateKindFile,
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

async function requireRequestsView(extra?: Permission) {
  const session = await getSessionUser();
  if (
    !session ||
    !(
      hasPermissionInSet(session.permissions, "requests.view", session.isSuperAdmin) ||
      (extra != null && hasPermissionInSet(session.permissions, extra, session.isSuperAdmin))
    )
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

type DocRow = Record<string, unknown> & { id: string };

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

async function getDoc(name: string, id: string): Promise<{ row: DocRow | null; error: string | null }> {
  const db = await openDb();
  if (!db) return { row: null, error: "not_configured" };
  try {
    const snap = await db.collection(name).doc(id).get();
    return { row: snap.exists ? docRow(snap.id, snap.data()) : null, error: null };
  } catch (e) {
    return { row: null, error: e instanceof Error ? e.message : "read_failed" };
  }
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
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "read_failed" };
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
  } catch (e) {
    return { count: 0, error: e instanceof Error ? e.message : "read_failed" };
  }
}

const REQUEST_ATTACHMENTS_BUCKET = "request-attachments";

function attachmentObjectPath(key: string): string {
  const trimmed = key.replace(/^\/+/, "");
  return trimmed.startsWith(`${REQUEST_ATTACHMENTS_BUCKET}/`)
    ? trimmed
    : `${REQUEST_ATTACHMENTS_BUCKET}/${trimmed}`;
}

async function uploadRequestAttachment(
  key: string,
  bytes: Buffer,
  contentType: string,
): Promise<{ error: string | null }> {
  const storage = await getFirebaseStorage();
  if (!storage) return { error: "not_configured" };
  try {
    const file = storage.bucket().file(attachmentObjectPath(key));
    const [exists] = await file.exists();
    if (exists) return { error: "already_exists" };
    await file.save(bytes, { contentType, resumable: false });
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "upload_failed" };
  }
}

async function signedAttachmentReadUrl(key: string): Promise<{ url: string | null; error?: string }> {
  const storage = await getFirebaseStorage();
  if (!storage) return { url: null, error: "not_configured" };
  try {
    const file = storage.bucket().file(attachmentObjectPath(key));
    const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 300_000 });
    return { url };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e.message : "sign_failed" };
  }
}

export async function fetchRequestTypeCounts(): Promise<{
  counts: Record<string, { total: number; pending: number }>;
  error?: string;
}> {
  await requireRequestsView();
  const { data, error } = await callAdminFunction("admin_count_requests_by_type");

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

export async function fetchAdminRequestsList(
  filters: RequestListFilters,
  extraView?: Permission,
): Promise<{
  rows: RequestListRow[];
  kpi: RequestKpis;
  filteredTotal: number;
  statusCounts: Record<string, number>;
  departmentOptions: RequestDepartmentOption[];
  error?: string;
}> {
  await requireRequestsView(extraView);
  const { from, to } = datePresetToBounds(filters.datePreset);

  const { data, error } = await callAdminFunction("admin_list_requests", {
    p_date_from: from ?? undefined,
    p_date_to: to ?? undefined,
    p_status: filters.status || undefined,
    p_type: filters.type || undefined,
    p_search: filters.search?.trim() || undefined,
    p_limit: filters.limit ?? 50,
    p_offset: filters.offset ?? 0,
    p_department_key: filters.departmentKey || undefined,
    p_zone_id: filters.zoneId || undefined,
    p_assigned_to_me: filters.assignedToMe || undefined,
    p_forwarded_to_me: filters.forwardedToMe || undefined,
    p_handled_by_me: filters.handledByMe || undefined,
    p_due_today: filters.dueToday || undefined,
    p_sort: filters.sort || undefined,
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
        employee_id: r.employee_id != null ? String(r.employee_id) : null,
        project_key: r.project_key != null ? String(r.project_key) : null,
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
        is_confidential: Boolean(r.is_confidential),
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

export type RequestsTrendBucket = { label: string; count: number };

export type RequestsTrend = {
  total: number;
  pendingAck: number;
  approved: number;
  rejected: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  volume: RequestsTrendBucket[];
  error?: string;
};

function numberMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(asRecord(value))) {
    out[key] = Number(raw ?? 0);
  }
  return out;
}

/**
 * The Reports page's aggregates, computed in the database over the whole filtered
 * window instead of over a capped page of rows.
 *
 * The page used to derive its total, breakdowns, acknowledgement count, approval
 * rate and twelve weekly bars from `fetchAdminRequestsList({ limit: 1000 })`, so
 * the figures were only correct while the window held fewer than 1000 requests —
 * and above that they were all short at once, with the current week's bar (the
 * one an operator looks at) short by the most. One statement over the filtered
 * set means the numbers cannot be capped by a limit that exists for a different
 * consumer.
 *
 * The filter predicate matches `admin_list_requests`, so this page and the list
 * it links from still describe one population.
 */
export async function fetchAdminRequestsTrend(
  filters: Pick<
    RequestListFilters,
    "datePreset" | "type" | "status" | "departmentKey" | "zoneId" | "search"
  > & { weeks?: number },
): Promise<RequestsTrend> {
  await requireRequestsView();
  const { from, to } = datePresetToBounds(filters.datePreset);

  const { data, error } = await callAdminFunction("admin_requests_trend", {
    p_date_from: from ?? undefined,
    p_date_to: to ?? undefined,
    p_type: filters.type || undefined,
    p_status: filters.status || undefined,
    p_department_key: filters.departmentKey || undefined,
    p_zone_id: filters.zoneId || undefined,
    p_search: filters.search?.trim() || undefined,
    p_weeks: filters.weeks ?? 12,
  });

  if (error) return { ...emptyTrend(), error: error.message };

  const payload = asRecord(data);
  if (payload.ok === false) {
    return { ...emptyTrend(), error: String(payload.error ?? "failed") };
  }

  const volumeRaw = Array.isArray(payload.volume) ? payload.volume : [];

  return {
    total: Number(payload.total ?? 0),
    pendingAck: Number(payload.pending_ack ?? 0),
    approved: Number(payload.approved ?? 0),
    rejected: Number(payload.rejected ?? 0),
    byType: numberMap(payload.by_type),
    byStatus: numberMap(payload.by_status),
    volume: volumeRaw.map((bucket) => {
      const b = asRecord(bucket);
      return { label: String(b.label ?? ""), count: Number(b.count ?? 0) };
    }),
  };
}

function emptyTrend(): RequestsTrend {
  return {
    total: 0,
    pendingAck: 0,
    approved: 0,
    rejected: 0,
    byType: {},
    byStatus: {},
    volume: [],
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

/** Page-open only. Refetch after decide must not insert a later Read. */
export async function logAdminRequestDetailOpened(requestId: string): Promise<void> {
  await requireRequestsView();
  await logAdminRead("requests", "requests.detail", { requestId });
}

export async function fetchAdminRequestDetail(requestId: string): Promise<{
  request: RequestDetail | null;
  steps: RequestApprovalStep[];
  clarifications: RequestClarification[];
  attachments: RequestAttachment[];
  comments: RequestComment[];
  error?: string;
}> {
  await requireRequestsView();
  const { data, error } = await callAdminFunction("admin_get_request", {
    p_request_id: requestId,
  });

  if (error) {
    return {
      request: null,
      steps: [],
      clarifications: [],
      attachments: [],
      comments: [],
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
      comments: [],
      error: String(payload.error ?? "failed"),
    };
  }

  const r = asRecord(payload.request);
  const requesterRaw = asRecord(payload.requester);
  const senderRaw = asRecord(payload.sender);
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
        requesterRaw.name != null || senderRaw.name != null
          ? {
              name: String(requesterRaw.name ?? senderRaw.name ?? ""),
              code: String(requesterRaw.code ?? senderRaw.driver_code ?? ""),
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
      is_confidential: Boolean(r.is_confidential ?? payload.confidential_revealed),
    },
    comments: (Array.isArray(payload.comments) ? payload.comments : []).map((row) => {
      const comment = asRecord(row);
      return {
        id: String(comment.id),
        body: String(comment.body ?? ""),
        author_id: String(comment.author_id ?? ""),
        author_name: comment.author_name != null ? String(comment.author_name) : null,
        created_at: String(comment.created_at ?? ""),
      };
    }),
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
        title: row.title != null ? String(row.title) : null,
        kind: row.kind != null ? String(row.kind) : null,
        captured_at: row.captured_at != null ? String(row.captured_at) : null,
        source: row.source != null ? String(row.source) : null,
      };
    }),
  };
}

function isFuelTransferType(value: unknown): value is FuelTransferType {
  return (FUEL_TRANSFER_TYPES as readonly string[]).includes(String(value));
}

const REQUEST_ATTACHMENTS_PREFIX = "request-attachments/";

export async function fetchRequestAttachmentUrl(
  storageKey: string,
): Promise<{ url: string | null; error?: string }> {
  const session = await getSessionUser();
  if (
    !session ||
    !(
      hasPermissionInSet(session.permissions, "requests.view", session.isSuperAdmin) ||
      hasPermissionInSet(session.permissions, "assets.view", session.isSuperAdmin) ||
      hasPermissionInSet(session.permissions, "fuel_requests.view", session.isSuperAdmin) ||
      hasPermissionInSet(session.permissions, "fuel_refunds.view", session.isSuperAdmin) ||
      hasPermissionInSet(session.permissions, "asset_requests.view", session.isSuperAdmin)
    )
  ) {
    throw new Error("not_authorized");
  }

  const normalized = storageKey.trim().replace(/^\/+/, "");
  if (!normalized) return { url: null };

  const requestObjectKey = normalized.startsWith(REQUEST_ATTACHMENTS_PREFIX)
    ? normalized.slice(REQUEST_ATTACHMENTS_PREFIX.length)
    : normalized;

  const signRequestAttachment = () => signedAttachmentReadUrl(requestObjectKey);

  const signR2 = async () => {
    try {
      return { url: await getPresignedGetUrl(normalized) };
    } catch (error) {
      return { url: null as string | null, error: error instanceof Error ? error.message : "sign_failed" };
    }
  };

  if (normalized.startsWith(REQUEST_ATTACHMENTS_PREFIX) || !isR2ObjectKey(normalized)) {
    const signed = await signRequestAttachment();
    if (signed.url) return signed;
    if (isR2ObjectKey(normalized)) return signR2();
    return signed;
  }

  const r2 = await signR2();
  if (r2.url) return r2;
  return signRequestAttachment();
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
  return attachmentDisplayName(name).slice(0, 180) || "attachment";
}

export async function uploadStaffRequestAttachments(input: {
  requestId: string;
  files: Array<{ name: string; type: string; base64: string }>;
}): Promise<{ ok: boolean; attachments?: RequestDecisionAttachment[]; error?: string }> {
  await requireRequestsDecide();
  if (input.files.length === 0) return { ok: false, error: "attachment_required" };

  const loaded = await getDoc(COLLECTIONS.requests, input.requestId);
  const driverId = loaded.row?.driver_id != null ? String(loaded.row.driver_id) : "";
  if (loaded.error || !driverId) {
    return { ok: false, error: loaded.error ?? "not_found" };
  }

  const attachments: RequestDecisionAttachment[] = [];

  for (const file of input.files) {
    const type = file.type || "application/octet-stream";
    if (!ATTACH_MIME.has(type)) return { ok: false, error: "invalid_attachment_type" };
    const bytes = Buffer.from(file.base64, "base64");
    if (bytes.length === 0 || bytes.length > ATTACH_MAX_BYTES) {
      return { ok: false, error: "invalid_attachment_size" };
    }
    const key = `${driverId}/${input.requestId}/${Date.now()}_${safeAttachmentName(file.name)}`;
    const uploaded = await uploadRequestAttachment(key, bytes, type);
    if (uploaded.error) return { ok: false, error: uploaded.error };
    attachments.push({
      storage_key: key,
      file_name: safeAttachmentName(file.name),
      content_type: type,
      byte_size: bytes.length,
    });
  }

  return { ok: true, attachments };
}

async function uploadOnBehalfCreateKindFiles(
  staffId: string,
  files: RequestCreateKindFile[],
): Promise<{
  ok: boolean;
  attachments?: Array<{
    storage_key: string;
    file_name: string;
    content_type: string;
    byte_size: number;
    title: string;
    kind: string;
    captured_at: string;
    source: "admin_upload";
  }>;
  error?: string;
}> {
  if (files.length === 0) return { ok: true, attachments: [] };
  const attachments: Array<{
    storage_key: string;
    file_name: string;
    content_type: string;
    byte_size: number;
    title: string;
    kind: string;
    captured_at: string;
    source: "admin_upload";
  }> = [];
  const capturedAt = new Date().toISOString();

  for (const file of files) {
    const type = file.type || "application/octet-stream";
    if (!ATTACH_MIME.has(type)) return { ok: false, error: "invalid_attachment_type" };
    const bytes = Buffer.from(file.base64, "base64");
    if (bytes.length === 0 || bytes.length > ATTACH_MAX_BYTES) {
      return { ok: false, error: "invalid_attachment_size" };
    }
    const key = `${staffId}/create/${Date.now()}_${attachments.length}_${safeAttachmentName(file.name)}`;
    const uploaded = await uploadRequestAttachment(key, bytes, type);
    if (uploaded.error) return { ok: false, error: uploaded.error };
    attachments.push({
      storage_key: key,
      file_name: safeAttachmentName(file.name),
      content_type: type,
      byte_size: bytes.length,
      title: file.title.trim() || file.kind,
      kind: file.kind,
      captured_at: capturedAt,
      source: "admin_upload",
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
  if (input.action === "reschedule" && !(input.reason ?? "").trim()) {
    return { ok: false, error: "reschedule_note_required" };
  }
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
  const { data, error } = await callAdminFunction("admin_decide_request", {
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

  const followUp = await maybeAutoCompleteSickLeaveDocumentsStep(
    input.requestId,
    input.action,
    staffDisplayName(session),
  );
  const status = followUp?.status ?? payload.status;

  await logAdminMutation({
    action: "update",
    entityType: "requests",
    entityId: input.requestId,
    routeName: "requests.decide",
    context: { decideAction: input.action, status },
  });

  if (followUp && !followUp.ok) {
    return { ok: false, error: followUp.error, status: status != null ? String(status) : undefined };
  }

  return { ok: true, status: status != null ? String(status) : undefined };
}

async function maybeAutoCompleteSickLeaveDocumentsStep(
  requestId: string,
  action: string,
  staffName: string | null,
): Promise<{ ok: boolean; error?: string; status?: string } | null> {
  if (action !== "approve") return null;

  const request = await getDoc(COLLECTIONS.requests, requestId);
  if (request.row?.request_type !== "sick_leave") return null;

  const counted = await countDocs(COLLECTIONS.requestAttachments, [["request_id", requestId]]);
  if (!counted.count) return null;

  const steps = await queryDocs(COLLECTIONS.requestApprovalSteps, [["request_id", requestId]]);
  const active = steps.rows.find((row) => row.status === "in_progress");
  if (Number(active?.step_order) !== 4) return null;

  const { data, error } = await callAdminFunction("admin_decide_request", {
    p_request_id: requestId,
    p_action: "approve",
    p_reason: undefined,
    p_meta: buildDecisionMeta(undefined, staffName),
  });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
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

  const succeeded: string[] = [];
  const failed: Array<{ requestId: string; error: string }> = [];

  for (const requestId of input.requestIds) {
    const { data, error } = await callAdminFunction("admin_decide_request", {
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
      await maybeAutoCompleteSickLeaveDocumentsStep(
        requestId,
        input.action,
        staffDisplayName(session),
      );
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

  const [driversListed, tenuresListed, categoriesListed, typesListed, fieldsListed] =
    await Promise.all([
      listDocs(COLLECTIONS.drivers),
      queryDocs("loan_tenure_options", [["is_active", true]]),
      queryDocs("complaint_categories", [["is_active", true]]),
      queryDocs(COLLECTIONS.requestTypeDefinitions, [["is_active", true]]),
      listDocs(COLLECTIONS.requestFieldDefinitions),
    ]);

  const error =
    driversListed.error ??
    tenuresListed.error ??
    categoriesListed.error ??
    typesListed.error ??
    fieldsListed.error;

  const liveDrivers = sortRows(
    driversListed.rows.filter((row) => row.archived_at == null),
    [["driver_code", "asc"]],
  );
  const profiles = await docsByIds(
    COLLECTIONS.profiles,
    liveDrivers.map((row) => row.id),
  );
  const profileById = new Map(profiles.map((row) => [row.id, row]));

  const types = sortRows(typesListed.rows, [["sort_order", "asc"]]).map((row) => ({
    key: String(row.key ?? row.id),
    label_en: row.label_en != null ? String(row.label_en) : "",
    label_ar: row.label_ar != null ? String(row.label_ar) : null,
    is_system: Boolean(row.is_system),
    date_range_required: Boolean(row.date_range_required),
    min_attachments: Number(row.min_attachments ?? 0),
  }));
  const typeKeys = new Set(types.map((row) => row.key));

  return {
    drivers: liveDrivers.map((row) => {
      const profile = profileById.get(row.id);
      return {
        id: row.id,
        full_name: String(profile?.full_name ?? row.driver_code ?? "—"),
        driver_code: row.driver_code != null ? String(row.driver_code) : "",
        employee_id: row.employee_id != null ? String(row.employee_id) : null,
        phone: profile?.phone != null ? String(profile.phone) : null,
      };
    }),
    loanTenures: sortRows(tenuresListed.rows, [
      ["sort_order", "asc"],
      ["months", "asc"],
    ]).map((row) => ({
      months: Number(row.months),
      label: row.label != null ? String(row.label) : `${row.months}`,
    })),
    complaintCategories: sortRows(categoriesListed.rows, [
      ["sort_order", "asc"],
      ["label_en", "asc"],
    ]).map((row) => ({
      key: String(row.key ?? row.id),
      label: row.label_en != null ? String(row.label_en) : String(row.key ?? row.id),
    })),
    types,
    fields: sortRows(fieldsListed.rows, [["sort_order", "asc"]])
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
  const session = await requireRequestsManage();
  if (
    typeof input.payload.needed_by === "string" &&
    isNeededByInPast(input.payload.needed_by, kuwaitTodayYmd())
  ) {
    return { ok: false, error: "date_in_past" };
  }

  const kindFiles = input.kindFiles ?? [];
  const kindList = kindFiles.map((file) => file.kind);
  if (new Set(kindList).size !== kindList.length) {
    return { ok: false, error: "invalid_attachment_kind" };
  }
  if (kindFiles.some((file) => !isKnownCreateKind(input.type, file.kind))) {
    return { ok: false, error: "invalid_attachment_kind" };
  }
  if (createKindSpecs(input.type).length > 0) {
    const missing = missingRequiredCreateKind(input.type, kindList);
    if (missing) return { ok: false, error: "kind_required" };
  }

  let pAttachments:
    | Array<{
        storage_key: string;
        file_name: string;
        content_type: string;
        byte_size: number;
        title: string;
        kind: string;
        captured_at: string;
        source: "admin_upload";
      }>
    | undefined;
  if (kindFiles.length > 0) {
    const uploaded = await uploadOnBehalfCreateKindFiles(session.id, kindFiles);
    if (!uploaded.ok) return { ok: false, error: uploaded.error };
    pAttachments = uploaded.attachments;
  }

  const { data, error } = await callAdminFunction("admin_create_request", {
    p_driver_id: input.driverId,
    p_type: input.type as "leave",
    p_payload: input.payload,
    p_amount_kwd: input.amountKwd ?? undefined,
    p_start_date: input.startDate ?? undefined,
    p_end_date: input.endDate ?? undefined,
    p_severity: (input.severity as "low") ?? undefined,
    p_details: input.details ?? undefined,
    ...(pAttachments ? { p_attachments: pAttachments } : {}),
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
  const { data, error } = await callAdminFunction("admin_set_fuel_transfer_type", {
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

  const { data, error } = await callAdminFunction("admin_set_request_decision_meta", {
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

export async function fetchStaffForForward(): Promise<
  Array<{ id: string; full_name: string; email: string | null }>
> {
  await requireRequestsDecide();
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

export async function forwardAdminRequest(input: {
  requestId: string;
  toUserId: string;
  note: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsDecide();
  const { data, error } = await callAdminFunction("admin_forward_request", {
    p_request_id: input.requestId,
    p_to_user: input.toUserId,
    p_note: input.note,
  });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
  await logAdminMutation({
    action: "update",
    entityType: "requests",
    entityId: input.requestId,
    routeName: "requests.forward",
    context: { to: input.toUserId },
  });
  return { ok: true };
}

export async function escalateAdminRequest(input: {
  requestId: string;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsDecide();
  const { data, error } = await callAdminFunction("admin_escalate_request", {
    p_request_id: input.requestId,
    p_note: input.note ?? "",
  });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
  return { ok: true };
}

export async function addAdminRequestComment(input: {
  requestId: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRequestsView();
  const { data, error } = await callAdminFunction("admin_add_request_comment", {
    p_request_id: input.requestId,
    p_body: input.body,
  });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
  return { ok: true };
}

export async function uploadIncomingDocument(input: {
  driverId: string;
  category: string;
  subject: string;
  receivedOn: string;
  startRoute: boolean;
  files: Array<{ name: string; type: string; base64: string }>;
}): Promise<{ ok: boolean; id?: string; request_code?: string; error?: string }> {
  const session = await requireRequestsManage();
  if (input.files.length === 0) return { ok: false, error: "attachment_required" };
  const uploaded = await uploadOnBehalfCreateKindFiles(
    session.id,
    input.files.map((file) => ({
      name: file.name,
      type: file.type,
      base64: file.base64,
      title: file.name,
      kind: "incoming",
    })),
  );
  if (!uploaded.ok || !uploaded.attachments) {
    return { ok: false, error: uploaded.error ?? "upload_failed" };
  }
  const { data, error } = await callAdminFunction("admin_upload_incoming_document", {
    p_driver_id: input.driverId,
    p_category: input.category,
    p_subject: input.subject,
    p_received_on: input.receivedOn,
    p_attachments: uploaded.attachments,
    p_start_route: input.startRoute,
  });
  if (error) return { ok: false, error: error.message };
  const payload = asRecord(data);
  if (payload.ok === false) return { ok: false, error: String(payload.error ?? "failed") };
  return {
    ok: true,
    id: payload.id != null ? String(payload.id) : undefined,
    request_code: payload.request_code != null ? String(payload.request_code) : undefined,
  };
}
