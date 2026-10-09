/**
 * RCM request list / detail / create / reporting callables.
 *
 * Ports `admin_list_requests` (20261118000200), `admin_get_request`
 * (20261118000100), `admin_create_request` (20261022100000) with its helpers
 * `rcm_validate_request_input` (20261112000000), `allocate_request_code`
 * (20261020100000) and `rcm_materialize_approval_steps` (20260831100200),
 * plus `admin_count_requests_by_type`, `admin_requests_trend` and
 * `admin_request_department_report`.
 *
 * The SQL joined `drivers`, `profiles` and the current approval step per row.
 * Here the window is read once and the joins are batched lookups, so the KPI
 * block, the status counts and the page are computed over the same in-memory
 * set — the property the SQL's shared `filtered` CTE existed to guarantee.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type Query,
} from "firebase-admin/firestore";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString } from "../core/kuwait";
import { requireStaff } from "../core/staff";
import {
  IN_FILTER_LIMIT,
  chunk,
  dataOf,
  isoTimestamp,
  loadDocMap,
  numberOrNull,
  pick,
  pickBoolean,
  pickCount,
  pickDay,
  pickId,
  pickInstant,
  pickText,
  type Dict,
} from "./_shared";

/** Requests are a few thousand a year; a window above this must be narrowed. */
const REQUEST_SCAN_CAP = 10000;
const DEFAULT_PAGE_LIMIT = 50;
const WEEK_SECONDS = 604800;
const OVERDUE_MS = 15 * 24 * 60 * 60 * 1000;

const CONFIDENTIAL_VIEWS_COLLECTION = "request_confidential_views";
const LOAN_TENURE_OPTIONS_COLLECTION = "loan_tenure_options";
const COMPLAINT_CATEGORIES_COLLECTION = "complaint_categories";

const REQUEST_CODE_COUNTER = "request_code_seq";
const FUEL_REFUND_CODE_COUNTER = "fuel_refund_code_seq";

const OPEN_STATUSES = new Set([
  "pending",
  "submitted",
  "in_review",
  "needs_clarification",
  "rescheduled",
]);
const TERMINAL_STATUSES = new Set(["approved", "rejected", "solved", "responded", "closed"]);
const BY_TYPE_PENDING_STATUSES = ["pending", "submitted", "in_review", "needs_clarification"];
const VEHICLE_SNAPSHOT_TYPES = new Set(["fuel", "fuel_refund", "asset"]);
const SICK_LEAVE_OTHER_SUBTYPES = new Set(["other", "أخرى"]);

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Postgres `->>`: scalars become their text form, containers their JSON text. */
function jsonText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

function instantOf(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  return null;
}

function boolOf(value: unknown): boolean {
  return value === true || value === "true";
}

function intOf(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

/** Postgres `initcap`: first letter of each alphanumeric run upper, rest lower. */
function initcap(value: string): string {
  let out = "";
  let boundary = true;
  for (const char of value.toLowerCase()) {
    const alnum = /[\p{L}\p{N}]/u.test(char);
    out += boundary && alnum ? char.toUpperCase() : char;
    boundary = !alnum;
  }
  return out;
}

function containsCi(haystack: string | null, needle: string): boolean {
  return haystack !== null && haystack.toLowerCase().includes(needle.toLowerCase());
}

/** `timestamptz - interval '1 month'`, clamping to the target month's last day. */
function minusOneMonth(at: Date): Date {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const targetYear = month === 0 ? year - 1 : year;
  const targetMonth = month === 0 ? 11 : month - 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(at.getUTCDate(), lastDay),
      at.getUTCHours(),
      at.getUTCMinutes(),
      at.getUTCSeconds(),
      at.getUTCMilliseconds(),
    ),
  );
}

/** A Firestore document as the `to_jsonb(row)` the SQL returned. */
function serialize(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object" && value !== null) {
    const out: Dict = {};
    for (const [key, inner] of Object.entries(value as Dict)) out[key] = serialize(inner);
    return out;
  }
  return value ?? null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function byInstant(field: string, direction: 1 | -1 = 1) {
  return (a: Dict, b: Dict): number => {
    const left = instantOf(a[field])?.getTime() ?? 0;
    const right = instantOf(b[field])?.getTime() ?? 0;
    return (left - right) * direction;
  };
}

// ---------------------------------------------------------------------------
// Shared loaders
// ---------------------------------------------------------------------------

type RequestRow = { id: string; data: Dict; createdAt: Date | null };

async function scanRequests(lower: Date | null, upper: Date | null): Promise<RequestRow[]> {
  let query: Query = getFirestore().collection(COLLECTIONS.requests);
  if (lower) query = query.where("created_at", ">=", Timestamp.fromDate(lower));
  if (upper) query = query.where("created_at", "<", Timestamp.fromDate(upper));
  const snap = await query.limit(REQUEST_SCAN_CAP + 1).get();
  if (snap.size > REQUEST_SCAN_CAP) {
    throw new HttpsError("out-of-range", "request_window_too_large");
  }
  return snap.docs.map((doc) => {
    const data = dataOf(doc);
    return { id: doc.id, data, createdAt: instantOf(data.created_at) };
  });
}

type Senders = { drivers: Map<string, Dict>; profiles: Map<string, Dict> };

async function loadSenders(rows: readonly RequestRow[]): Promise<Senders> {
  const driverIds = rows
    .map((row) => textOf(row.data.driver_id))
    .filter((id): id is string => id !== null);
  const [drivers, profiles] = await Promise.all([
    loadDocMap(COLLECTIONS.drivers, driverIds),
    loadDocMap(COLLECTIONS.profiles, driverIds),
  ]);
  return { drivers, profiles };
}

function senderName(senders: Senders, driverId: string | null): string | null {
  if (!driverId) return null;
  return (
    textOf(senders.profiles.get(driverId)?.full_name) ??
    textOf(senders.drivers.get(driverId)?.name)
  );
}

function senderCode(senders: Senders, driverId: string | null): string | null {
  if (!driverId) return null;
  return textOf(senders.drivers.get(driverId)?.driver_code);
}

/** `request_departments` labels for active rows, keyed by department key. */
async function loadDepartmentLabels(): Promise<Map<string, string>> {
  const snap = await getFirestore().collection(COLLECTIONS.requestDepartments).get();
  const out = new Map<string, string>();
  for (const doc of snap.docs) {
    const data = dataOf(doc);
    if (!boolOf(data.is_active)) continue;
    const key = textOf(data.key) ?? doc.id;
    const label = textOf(data.label_en);
    if (label) out.set(key, label);
  }
  return out;
}

function departmentLabel(labels: Map<string, string>, key: string | null): string | null {
  if (!key) return null;
  return labels.get(key) ?? initcap(key.replace(/_/g, " "));
}

/** `request_id -> step_orders` for every step whose `field` equals `value`. */
async function stepOrdersWhere(field: string, value: string): Promise<Map<string, Set<number>>> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.requestApprovalSteps)
    .where(field, "==", value)
    .limit(REQUEST_SCAN_CAP * 4)
    .get();
  const out = new Map<string, Set<number>>();
  for (const doc of snap.docs) {
    const data = dataOf(doc);
    const requestId = textOf(data.request_id);
    const order = intOf(data.step_order);
    if (!requestId || order === null) continue;
    const set = out.get(requestId) ?? new Set<number>();
    set.add(order);
    out.set(requestId, set);
  }
  return out;
}

/** Every step of the given requests, grouped by request id. */
async function loadStepsFor(requestIds: readonly string[]): Promise<Map<string, Dict[]>> {
  const db = getFirestore();
  const unique = [...new Set(requestIds)];
  const out = new Map<string, Dict[]>();
  const snaps = await Promise.all(
    chunk(unique, IN_FILTER_LIMIT).map((group) =>
      db.collection(COLLECTIONS.requestApprovalSteps).where("request_id", "in", group).get(),
    ),
  );
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const data: Dict = { id: doc.id, ...dataOf(doc) };
      const requestId = textOf(data.request_id);
      if (!requestId) continue;
      const list = out.get(requestId) ?? [];
      list.push(data);
      out.set(requestId, list);
    }
  }
  return out;
}

function currentStepOf(row: RequestRow, steps: Map<string, Dict[]>): Dict | null {
  const current = intOf(row.data.current_step_order);
  if (current === null) return null;
  return (steps.get(row.id) ?? []).find((step) => intOf(step.step_order) === current) ?? null;
}

// ---------------------------------------------------------------------------
// Filters shared by the list and the trend
// ---------------------------------------------------------------------------

type RequestFilterArgs = {
  type: string | null;
  status: string | null;
  zoneId: string | null;
  departmentKey: string | null;
  search: string | null;
};

function readFilterArgs(data: Dict): RequestFilterArgs {
  return {
    type: pickText(data, "type", "p_type"),
    status: pickText(data, "status", "p_status"),
    zoneId: pickId(data, "zoneId", "p_zone_id"),
    departmentKey: pickText(data, "departmentKey", "p_department_key"),
    search: pickText(data, "search", "p_search"),
  };
}

/** `cur.role_key = p_department_key` against the current step. */
function inDepartment(
  row: RequestRow,
  departmentKey: string | null,
  departmentSteps: Map<string, Set<number>> | null,
): boolean {
  if (departmentKey === null) return true;
  const current = intOf(row.data.current_step_order);
  return current !== null && (departmentSteps?.get(row.id)?.has(current) ?? false);
}

function inZone(row: RequestRow, senders: Senders, zoneId: string | null): boolean {
  if (zoneId === null) return true;
  const driverId = textOf(row.data.driver_id);
  return driverId !== null && textOf(senders.drivers.get(driverId)?.zone_id) === zoneId;
}

function matchesSearch(
  row: RequestRow,
  senders: Senders,
  search: string | null,
  maskConfidential: boolean,
): boolean {
  if (search === null) return true;
  if (containsCi(textOf(row.data.request_code), search)) return true;
  if (maskConfidential && boolOf(row.data.is_confidential)) return false;
  const driverId = textOf(row.data.driver_id);
  return (
    containsCi(senderName(senders, driverId), search) ||
    containsCi(senderCode(senders, driverId), search)
  );
}

function statusOf(row: RequestRow): string {
  return textOf(row.data.status) ?? "";
}

function inWindow(row: RequestRow, from: Date | null, to: Date | null): boolean {
  if (from === null && to === null) return true;
  if (row.createdAt === null) return false;
  if (from !== null && row.createdAt < from) return false;
  if (to !== null && row.createdAt >= to) return false;
  return true;
}

// ---------------------------------------------------------------------------
// admin_list_requests
// ---------------------------------------------------------------------------

type KpiBlock = {
  total: number;
  pending: number;
  overdue: number;
  avg: number | null;
};

function kpiOf(rows: readonly RequestRow[], now: number): KpiBlock {
  let pending = 0;
  let overdue = 0;
  const durations: number[] = [];
  for (const row of rows) {
    const status = statusOf(row);
    if (OPEN_STATUSES.has(status)) pending += 1;
    const completedAt = instantOf(row.data.completed_at);
    if (
      completedAt === null &&
      !TERMINAL_STATUSES.has(status) &&
      row.createdAt !== null &&
      row.createdAt.getTime() < now - OVERDUE_MS
    ) {
      overdue += 1;
    }
    if (completedAt !== null && row.createdAt !== null) {
      durations.push((completedAt.getTime() - row.createdAt.getTime()) / 1000);
    }
  }
  return { total: rows.length, pending, overdue, avg: average(durations) };
}

/**
 * `admin_list_requests` — KPIs (with the previous-month comparison), status
 * counts and department options over one filtered set, then a page of rows.
 * The status tab narrows the rows and `filtered_total` only; the KPIs and the
 * status counts deliberately describe every status.
 */
export const adminListRequests = onCall(async (request) => {
  const staff = await requireStaff(request, "requests.view");
  const data = (request.data ?? {}) as Dict;
  const uid = staff.uid;

  const from = pickInstant(data, "dateFrom", "p_date_from");
  const to = pickInstant(data, "dateTo", "p_date_to");
  const filters = readFilterArgs(data);
  const limit = Math.max(pickCount(data, DEFAULT_PAGE_LIMIT, "limit", "p_limit"), 1);
  const offset = Math.max(pickCount(data, 0, "offset", "p_offset"), 0);
  const assignedToMe = pickBoolean(data, "assignedToMe", "p_assigned_to_me");
  const forwardedToMe = pickBoolean(data, "forwardedToMe", "p_forwarded_to_me");
  const handledByMe = pickBoolean(data, "handledByMe", "p_handled_by_me");
  const dueToday = pickBoolean(data, "dueToday", "p_due_today");
  const sort = (pickText(data, "sort", "p_sort") ?? "").toLowerCase();
  const oldest = sort === "oldest" || sort === "oldest_first" || sort === "asc";

  const prevFrom = from !== null && to !== null ? minusOneMonth(from) : null;
  const prevTo = from !== null && to !== null ? minusOneMonth(to) : null;

  const db = getFirestore();
  const [scanned, departmentSteps, assignedSteps, forwardedIds, handledIds, labels, templatesSnap] =
    await Promise.all([
      scanRequests(prevFrom ?? from, to),
      filters.departmentKey !== null
        ? stepOrdersWhere("role_key", filters.departmentKey)
        : Promise.resolve(null),
      assignedToMe ? stepOrdersWhere("assigned_user_id", uid) : Promise.resolve(null),
      forwardedToMe
        ? db
            .collection(COLLECTIONS.requestForwards)
            .where("to_user", "==", uid)
            .get()
            .then(
              (snap) =>
                new Set(
                  snap.docs
                    .map((doc) => textOf(doc.get("request_id")))
                    .filter((id): id is string => id !== null),
                ),
            )
        : Promise.resolve(null),
      handledByMe ? stepOrdersWhere("decided_by", uid) : Promise.resolve(null),
      loadDepartmentLabels(),
      db.collection(COLLECTIONS.requestApprovalStepTemplates).get(),
    ]);

  const typed = scanned.filter(
    (row) => filters.type === null || textOf(row.data.request_type) === filters.type,
  );
  const senders = await loadSenders(typed);
  const today = kuwaitDayString(new Date());

  const filtered = typed.filter((row) => {
    if (!inZone(row, senders, filters.zoneId)) return false;
    if (!inDepartment(row, filters.departmentKey, departmentSteps)) return false;
    if (!matchesSearch(row, senders, filters.search, true)) return false;
    if (assignedToMe) {
      const current = intOf(row.data.current_step_order);
      const viaStep = current !== null && (assignedSteps?.get(row.id)?.has(current) ?? false);
      if (textOf(row.data.assigned_to) !== uid && !viaStep) return false;
    }
    if (forwardedToMe && !(forwardedIds?.has(row.id) ?? false)) return false;
    if (handledByMe && !(handledIds?.has(row.id) ?? false)) return false;
    if (dueToday) {
      const due = instantOf(row.data.sla_due_at);
      if (due === null || kuwaitDayString(due) !== today) return false;
    }
    return true;
  });

  const now = Date.now();
  const base = filtered.filter((row) => inWindow(row, from, to));
  const prev =
    prevFrom !== null && prevTo !== null
      ? filtered.filter((row) => inWindow(row, prevFrom, prevTo))
      : null;

  const kpi = kpiOf(base, now);
  const prevKpi = prev ? kpiOf(prev, now) : null;

  const statusCounts: Record<string, number> = {};
  for (const row of base) {
    const status = statusOf(row);
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }

  const matching = base.filter((row) => filters.status === null || statusOf(row) === filters.status);
  matching.sort((a, b) => {
    const left = a.createdAt?.getTime() ?? 0;
    const right = b.createdAt?.getTime() ?? 0;
    if (left !== right) return oldest ? left - right : right - left;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const page = matching.slice(offset, offset + limit);

  const pageSteps = await loadStepsFor(page.map((row) => row.id));
  const zoneIds = page
    .map((row) => {
      const driverId = textOf(row.data.driver_id);
      return driverId ? textOf(senders.drivers.get(driverId)?.zone_id) : null;
    })
    .filter((id): id is string => id !== null);
  const zones = await loadDocMap(COLLECTIONS.zones, zoneIds);

  const rows = page.map((row) => {
    const r = row.data;
    const driverId = textOf(r.driver_id);
    const driver = driverId ? senders.drivers.get(driverId) : undefined;
    const confidential = boolOf(r.is_confidential);
    const zoneId = textOf(driver?.zone_id);
    const cur = currentStepOf(row, pageSteps);
    const departmentKey = textOf(cur?.role_key);
    const payload = (r.payload ?? {}) as Dict;
    return {
      id: row.id,
      request_code: r.request_code ?? null,
      request_type: r.request_type ?? null,
      status: r.status ?? null,
      current_step_label: r.current_step_label ?? null,
      current_step_order: r.current_step_order ?? null,
      driver_id: driverId,
      amount_kwd: r.amount_kwd ?? null,
      needs_attention: r.needs_attention ?? null,
      attention_at: isoTimestamp(r.attention_at),
      created_at: isoTimestamp(r.created_at),
      severity: r.severity ?? null,
      sla_due_at: isoTimestamp(r.sla_due_at),
      is_confidential: confidential,
      awaiting_driver_ack: boolOf(payload.awaiting_driver_ack),
      driver_name: confidential ? null : senderName(senders, driverId),
      driver_code: confidential ? null : textOf(driver?.driver_code),
      employee_id: confidential ? null : textOf(driver?.employee_id),
      project_key: confidential ? null : textOf(driver?.project_key),
      driver_zone: confidential
        ? null
        : (zoneId ? textOf(zones.get(zoneId)?.name) : null) ?? textOf(driver?.zone_name),
      sender_masked: confidential,
      department_key: departmentKey,
      department_label: departmentLabel(labels, departmentKey),
      assigned_to: r.assigned_to ?? null,
      assigned_user_id: cur?.assigned_user_id ?? null,
    };
  });

  const departmentOptions = new Map<string, string>();
  for (const doc of templatesSnap.docs) {
    const t = dataOf(doc);
    const roleKey = textOf(t.role_key);
    if (!roleKey || roleKey === "system" || boolOf(t.is_system_auto)) continue;
    departmentOptions.set(roleKey, departmentLabel(labels, roleKey) ?? roleKey);
  }

  return {
    ok: true,
    kpi: {
      total: kpi.total,
      pending: kpi.pending,
      overdue: kpi.overdue,
      avg_resolution_seconds: kpi.avg,
      prev_total: prevKpi?.total ?? null,
      prev_pending: prevKpi?.pending ?? null,
      prev_overdue: prevKpi?.overdue ?? null,
      prev_avg_resolution_seconds: prevKpi?.avg ?? null,
    },
    filtered_total: matching.length,
    status_counts: statusCounts,
    department_options: [...departmentOptions.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    rows,
  };
});

// ---------------------------------------------------------------------------
// admin_get_request
// ---------------------------------------------------------------------------

/**
 * `admin_get_request` — clears the attention badge, records the reveal of a
 * confidential sender, and returns the request with its staff-only comments,
 * forwards, steps (plus the template's allowed actions), clarifications and
 * attachments.
 */
export const adminGetRequest = onCall(async (request) => {
  const staff = await requireStaff(request, "requests.view");
  const data = (request.data ?? {}) as Dict;
  const requestId = pickId(data, "requestId", "p_request_id", "id");
  if (!requestId) return { ok: false, error: "not_found" };

  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.requests).doc(requestId);
  const first = await ref.get();
  if (!first.exists) return { ok: false, error: "not_found" };

  await ref.update({
    needs_attention: false,
    attention_cleared_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  });
  const snap = await ref.get();
  const req = dataOf(snap);
  const confidential = boolOf(req.is_confidential);

  if (confidential) {
    await db
      .collection(CONFIDENTIAL_VIEWS_COLLECTION)
      .doc(`${requestId}_${staff.uid}`)
      .set(
        {
          request_id: requestId,
          viewer_id: staff.uid,
          viewed_at: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  }

  const driverId = textOf(req.driver_id);
  const requestType = textOf(req.request_type);
  const byRequest = (collection: string) =>
    db.collection(collection).where("request_id", "==", requestId).get();

  const [driverSnap, profileSnap, commentsSnap, forwardsSnap, stepsSnap, templatesSnap, clarSnap, attSnap] =
    await Promise.all([
      driverId ? db.collection(COLLECTIONS.drivers).doc(driverId).get() : Promise.resolve(null),
      driverId ? db.collection(COLLECTIONS.profiles).doc(driverId).get() : Promise.resolve(null),
      byRequest(COLLECTIONS.requestComments),
      byRequest(COLLECTIONS.requestForwards),
      byRequest(COLLECTIONS.requestApprovalSteps),
      requestType
        ? db
            .collection(COLLECTIONS.requestApprovalStepTemplates)
            .where("request_type", "==", requestType)
            .get()
        : Promise.resolve(null),
      byRequest(COLLECTIONS.requestClarifications),
      byRequest(COLLECTIONS.requestAttachments),
    ]);

  const driver = driverSnap?.exists ? dataOf(driverSnap) : null;
  const profile = profileSnap?.exists ? dataOf(profileSnap) : null;

  const comments = commentsSnap.docs.map((doc): Dict => ({ id: doc.id, ...dataOf(doc) }));
  comments.sort(byInstant("created_at"));
  const authors = await loadDocMap(
    COLLECTIONS.profiles,
    comments.map((c) => textOf(c.author_id)).filter((id): id is string => id !== null),
  );

  const forwards = forwardsSnap.docs.map((doc): Dict => ({ id: doc.id, ...dataOf(doc) }));
  forwards.sort(byInstant("created_at"));

  const allowedByOrder = new Map<number, unknown[]>();
  for (const doc of templatesSnap?.docs ?? []) {
    const t = dataOf(doc);
    const order = intOf(t.step_order);
    if (order !== null) {
      allowedByOrder.set(order, Array.isArray(t.allowed_actions) ? t.allowed_actions : []);
    }
  }
  const steps = stepsSnap.docs
    .map((doc): Dict => {
      const step = dataOf(doc);
      const order = intOf(step.step_order);
      return {
        ...(serialize({ id: doc.id, ...step }) as Dict),
        allowed_actions: (order !== null ? allowedByOrder.get(order) : undefined) ?? [],
      };
    })
    .sort((a, b) => (intOf(a.step_order) ?? 0) - (intOf(b.step_order) ?? 0));

  const clarifications = clarSnap.docs.map((doc): Dict => ({ id: doc.id, ...dataOf(doc) }));
  clarifications.sort(byInstant("asked_at"));
  const attachments = attSnap.docs.map((doc): Dict => ({ id: doc.id, ...dataOf(doc) }));
  attachments.sort(byInstant("created_at"));

  return {
    ok: true,
    request: serialize({ id: snap.id, ...req }),
    sender: {
      name: driver ? textOf(profile?.full_name) ?? textOf(driver.name) : null,
      driver_code: driver ? textOf(driver.driver_code) : null,
      employee_id: driver ? textOf(driver.employee_id) : null,
    },
    confidential_revealed: confidential,
    comments: comments.map((c) => {
      const authorId = textOf(c.author_id);
      return {
        id: c.id,
        body: c.body ?? null,
        author_id: authorId,
        author_name: authorId ? textOf(authors.get(authorId)?.full_name) : null,
        created_at: isoTimestamp(c.created_at),
      };
    }),
    forwards: forwards.map((f) => ({
      id: f.id,
      from_user: f.from_user ?? null,
      to_user: f.to_user ?? null,
      note: f.note ?? null,
      created_at: isoTimestamp(f.created_at),
    })),
    steps,
    clarifications: clarifications.map(serialize),
    attachments: attachments.map(serialize),
  };
});

// ---------------------------------------------------------------------------
// rcm_validate_request_input / allocate_request_code / rcm_materialize_approval_steps
// ---------------------------------------------------------------------------

export type RequestInput = {
  type: string | null;
  payload: Dict;
  attachments: unknown[];
  amountKwd: number | null;
  startDate: string | null;
  endDate: string | null;
  details: string | null;
  severity: string | null;
};

function targetValue(input: RequestInput, target: string | null, fieldKey: string | null): string | null {
  switch (target) {
    case "amount_kwd":
      return input.amountKwd === null ? null : String(input.amountKwd);
    case "start_date":
      return input.startDate;
    case "end_date":
      return input.endDate;
    case "details":
      return input.details;
    case "severity":
      return input.severity;
    default:
      return fieldKey === null ? null : jsonText(input.payload[fieldKey]);
  }
}

function trimmedOrNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function loadRequestTypeDefinition(type: string): Promise<Dict | null> {
  const db = getFirestore();
  const byId = await db.collection(COLLECTIONS.requestTypeDefinitions).doc(type).get();
  if (byId.exists) return dataOf(byId);
  const byKey = await db
    .collection(COLLECTIONS.requestTypeDefinitions)
    .where("key", "==", type)
    .limit(1)
    .get();
  return byKey.empty ? null : dataOf(byKey.docs[0]);
}

/**
 * `rcm_validate_request_input` — the server-side gate both create paths share.
 * Returns the SQL's error code, or `null` when the input is acceptable.
 */
export async function validateRequestInput(input: RequestInput): Promise<string | null> {
  if (input.type === null) return "unknown_request_type";
  const def = await loadRequestTypeDefinition(input.type);
  if (def === null) return "unknown_request_type";
  if (!boolOf(def.is_active)) return "request_type_inactive";

  const db = getFirestore();
  const fieldsSnap = await db
    .collection(COLLECTIONS.requestFieldDefinitions)
    .where("type_key", "==", input.type)
    .get();
  const fields = fieldsSnap.docs.map((doc) => dataOf(doc));
  fields.sort((a, b) => {
    const order = (numberOrNull(a.sort_order) ?? 0) - (numberOrNull(b.sort_order) ?? 0);
    if (order !== 0) return order;
    const left = textOf(a.field_key) ?? "";
    const right = textOf(b.field_key) ?? "";
    return left < right ? -1 : left > right ? 1 : 0;
  });

  let tenures: Dict[] | null = null;
  let categories: Dict[] | null = null;

  for (const field of fields) {
    const kind = textOf(field.kind);
    const target = textOf(field.target);
    const fieldKey = textOf(field.field_key);
    if (kind === "file" || target === "attachments") continue;

    const value = trimmedOrNull(targetValue(input, target, fieldKey));
    const present = value !== null;

    const visibleWhen =
      typeof field.visible_when === "object" && field.visible_when !== null
        ? (field.visible_when as Dict)
        : null;
    if (visibleWhen !== null) {
      const parentKey = textOf(visibleWhen.field_key);
      const parentValue =
        parentKey === null ? null : trimmedOrNull(targetValue(input, parentKey, parentKey));
      const allowed = visibleWhen.in;
      const visible =
        parentKey !== null &&
        parentValue !== null &&
        Array.isArray(allowed) &&
        allowed.some((option) => jsonText(option) === parentValue);
      if (!visible) continue;
    }

    const requiredCode =
      textOf(field.required_error_code) ?? `field_required:${fieldKey ?? ""}`;
    if (boolOf(field.is_server_required) && !present) return requiredCode;
    if (!present && boolOf(visibleWhen?.required)) return requiredCode;

    if (present && kind === "number") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return `invalid_number:${fieldKey ?? ""}`;
      const min = numberOrNull(field.min_value);
      const max = numberOrNull(field.max_value);
      if (min !== null && parsed < min) return `number_too_small:${fieldKey ?? ""}`;
      if (max !== null && parsed > max) return `number_too_large:${fieldKey ?? ""}`;
    }

    const optionsCode = textOf(field.options_error_code) ?? `invalid_option:${fieldKey ?? ""}`;
    const optionsSource = textOf(field.options_source);
    if (present && optionsSource === "loan_tenure_options") {
      tenures ??= (await db.collection(LOAN_TENURE_OPTIONS_COLLECTION).get()).docs.map((d) =>
        dataOf(d),
      );
      const ok = tenures.some((t) => boolOf(t.is_active) && jsonText(t.months) === value);
      if (!ok) return optionsCode;
    } else if (present && optionsSource === "complaint_categories") {
      categories ??= (await db.collection(COMPLAINT_CATEGORIES_COLLECTION).get()).docs.map((d) =>
        dataOf(d),
      );
      const ok = categories.some(
        (c) => boolOf(c.is_active) && (textOf(c.key) === value || textOf(c.label_en) === value),
      );
      if (!ok) return optionsCode;
    } else if (present && (kind === "select" || kind === "multiselect")) {
      const options = Array.isArray(field.options) ? field.options : null;
      const hasStatic =
        optionsSource === "static" ||
        (optionsSource === null && options !== null && options.length > 0);
      if (hasStatic) {
        const allowed = new Set((options ?? []).map((option) => jsonText(option)));
        if (kind === "multiselect") {
          const chosen = fieldKey === null ? undefined : input.payload[fieldKey];
          const list = Array.isArray(chosen) ? chosen : [];
          if (list.some((item) => !allowed.has(jsonText(item)))) return optionsCode;
        } else if (!allowed.has(value)) {
          return optionsCode;
        }
      }
    }
  }

  if (boolOf(def.date_range_required)) {
    if (input.startDate === null) return "field_required:start_date";
    if (input.endDate === null) return "field_required:end_date";
    if (input.endDate < input.startDate) return "invalid_date_range";
  }

  const neededBy = trimmedOrNull(jsonText(input.payload.needed_by));
  if (neededBy !== null) {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(neededBy);
    const parsed = match ? new Date(`${match[1]}T00:00:00Z`) : null;
    if (match === null || parsed === null || Number.isNaN(parsed.getTime())) {
      return "date_in_past:needed_by";
    }
    if (match[1] < kuwaitDayString(new Date())) return "date_in_past:needed_by";
  }

  const subtype = (jsonText(input.payload.leave_subtype) ?? "").trim().toLowerCase();
  if (
    input.type === "sick_leave" &&
    SICK_LEAVE_OTHER_SUBTYPES.has(subtype) &&
    trimmedOrNull(jsonText(input.payload.leave_subtype_other)) === null
  ) {
    return "field_required:leave_subtype_other";
  }

  const minAttachments = numberOrNull(def.min_attachments);
  if (minAttachments !== null && input.attachments.length < minAttachments) {
    return textOf(def.attachments_error_code) ?? "attachments_required";
  }

  return null;
}

/** `allocate_request_code(p_type)` — RFR-#### for fuel refunds, RCM-#### otherwise. */
export async function allocateRequestCode(type: string): Promise<string> {
  const isRefund = type === "fuel_refund";
  const db = getFirestore();
  const counterRef = db
    .collection(COLLECTIONS.counters)
    .doc(isRefund ? FUEL_REFUND_CODE_COUNTER : REQUEST_CODE_COUNTER);
  const seq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const last = numberOrNull(snap.get("value"));
    const next = last === null ? 1 : Math.trunc(last) + 1;
    tx.set(counterRef, { value: next, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
  return `${isRefund ? "RFR-" : "RCM-"}${String(seq).padStart(4, "0")}`;
}

/**
 * `rcm_materialize_approval_steps` — copies the type's step templates onto the
 * request (step 1 completed, step 2 in progress, the rest pending; existing
 * steps are left alone) and points the request at the active step.
 */
export async function materializeApprovalSteps(requestId: string): Promise<void> {
  const db = getFirestore();
  const reqRef = db.collection(COLLECTIONS.requests).doc(requestId);

  await db.runTransaction(async (tx) => {
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists) throw new HttpsError("not-found", "request_not_found");
    const req = dataOf(reqSnap);
    const driverId = textOf(req.driver_id);
    const requestType = textOf(req.request_type);

    const [profileSnap, templatesSnap, existingSnap] = await Promise.all([
      driverId ? tx.get(db.collection(COLLECTIONS.profiles).doc(driverId)) : Promise.resolve(null),
      requestType
        ? tx.get(
            db
              .collection(COLLECTIONS.requestApprovalStepTemplates)
              .where("request_type", "==", requestType),
          )
        : Promise.resolve(null),
      tx.get(db.collection(COLLECTIONS.requestApprovalSteps).where("request_id", "==", requestId)),
    ]);

    const driverName = profileSnap?.exists ? textOf(profileSnap.get("full_name"))?.trim() ?? null : null;
    const now = Timestamp.now();
    const steps = new Map<number, Dict>();
    for (const doc of existingSnap.docs) {
      const step = dataOf(doc);
      const order = intOf(step.step_order);
      if (order !== null) steps.set(order, step);
    }

    const templates = (templatesSnap?.docs ?? [])
      .map((doc) => dataOf(doc))
      .filter((t) => intOf(t.step_order) !== null)
      .sort((a, b) => (intOf(a.step_order) ?? 0) - (intOf(b.step_order) ?? 0));

    for (const t of templates) {
      const order = intOf(t.step_order) as number;
      if (steps.has(order)) continue;
      const slaMinutes = numberOrNull(t.sla_minutes);
      const step: Dict = {
        request_id: requestId,
        step_order: order,
        step_name: t.step_name ?? null,
        role_key: t.role_key ?? null,
        status: order === 1 ? "completed" : order === 2 ? "in_progress" : "pending",
        started_at: order <= 2 ? now : null,
        decided_at: order === 1 ? now : null,
        actor_display_name: order === 1 ? driverName : null,
        sla_due_at:
          order === 2 && slaMinutes !== null
            ? Timestamp.fromMillis(now.toMillis() + slaMinutes * 60_000)
            : null,
        breach_action: order === 2 ? t.breach_action ?? null : null,
        created_at: now,
        updated_at: now,
      };
      tx.create(db.collection(COLLECTIONS.requestApprovalSteps).doc(`${requestId}_${order}`), step);
      steps.set(order, step);
    }

    const active = [...steps.entries()]
      .filter(([, step]) => step.status === "in_progress")
      .sort(([a], [b]) => a - b)[0]?.[1];

    tx.update(reqRef, {
      current_step_order: active ? intOf(active.step_order) : 1,
      current_step_label: (active ? textOf(active.step_name) : null) ?? "Submitted",
      status: "submitted",
      sla_due_at: active?.sla_due_at ?? null,
      sla_breach_action: active?.breach_action ?? null,
      updated_at: FieldValue.serverTimestamp(),
    });
  });
}

// ---------------------------------------------------------------------------
// admin_create_request
// ---------------------------------------------------------------------------

function attachmentsOf(data: Dict): unknown[] {
  const value = pick(data, "attachments", "p_attachments");
  return Array.isArray(value) ? value : [];
}

/**
 * `admin_create_request` — raises a request on behalf of a rider with the same
 * validation the rider's own create runs, stamps `created_on_behalf*` on the
 * payload, snapshots the assigned vehicle for fuel / refund / asset, and
 * materialises the approval chain.
 */
export const adminCreateRequest = onCall(async (request) => {
  const staff = await requireStaff(request, "requests.manage");
  const data = (request.data ?? {}) as Dict;

  const driverId = pickId(data, "driverId", "p_driver_id");
  if (!driverId) return { ok: false, error: "driver_required" };

  const db = getFirestore();
  const driverSnap = await db.collection(COLLECTIONS.drivers).doc(driverId).get();
  const driver = dataOf(driverSnap);
  if (!driverSnap.exists || driver.archived_at) return { ok: false, error: "not_a_driver" };

  const rawPayload = pick(data, "payload", "p_payload");
  const payload =
    typeof rawPayload === "object" && rawPayload !== null && !Array.isArray(rawPayload)
      ? (rawPayload as Dict)
      : {};
  const input: RequestInput = {
    type: pickText(data, "type", "p_type"),
    payload,
    attachments: attachmentsOf(data),
    amountKwd: numberOrNull(pick(data, "amountKwd", "p_amount_kwd")),
    startDate: pickDay(data, "startDate", "p_start_date"),
    endDate: pickDay(data, "endDate", "p_end_date"),
    details: pickText(data, "details", "p_details"),
    severity: pickText(data, "severity", "p_severity"),
  };

  const error = await validateRequestInput(input);
  if (error !== null) return { ok: false, error };
  const type = input.type as string;

  const [actorSnap, driverProfileSnap] = await Promise.all([
    db.collection(COLLECTIONS.profiles).doc(staff.uid).get(),
    db.collection(COLLECTIONS.profiles).doc(driverId).get(),
  ]);
  const actorName = textOf(actorSnap.get("full_name"))?.trim() || null;

  const now = new Date();
  const mergedPayload: Dict = {
    ...payload,
    created_on_behalf: true,
    created_on_behalf_by: staff.uid,
    created_on_behalf_by_name: actorName ?? "Admin",
    created_on_behalf_at: now.toISOString(),
  };

  const vehicleId = VEHICLE_SNAPSHOT_TYPES.has(type) ? textOf(driver.vehicle_id) : null;
  const code = await allocateRequestCode(type);

  const reqRef = db.collection(COLLECTIONS.requests).doc();
  const nowTs = Timestamp.fromDate(now);
  await reqRef.set({
    request_code: code,
    driver_id: driverId,
    request_type: type,
    status: "submitted",
    payload: mergedPayload,
    amount_kwd: input.amountKwd,
    start_date: input.startDate,
    end_date: input.endDate,
    details: input.details,
    severity: input.severity,
    needs_attention: true,
    attention_at: nowTs,
    attention_reason: "new_request",
    vehicle_id: vehicleId,
    is_confidential: type === "complaint",
    driver_name: textOf(driverProfileSnap.get("full_name")) ?? textOf(driver.name),
    driver_code: textOf(driver.driver_code),
    employee_id: textOf(driver.employee_id),
    created_day: kuwaitDayString(now),
    created_at: nowTs,
    updated_at: nowTs,
  });

  await materializeApprovalSteps(reqRef.id);

  if (input.attachments.length > 0) {
    const batch = db.batch();
    for (const raw of input.attachments) {
      const att = typeof raw === "object" && raw !== null ? (raw as Dict) : {};
      const byteSize = numberOrNull(att.byte_size);
      const capturedAt = instantOf(att.captured_at);
      batch.set(db.collection(COLLECTIONS.requestAttachments).doc(), {
        request_id: reqRef.id,
        storage_key: jsonText(att.storage_key),
        file_name: jsonText(att.file_name),
        content_type: jsonText(att.content_type),
        byte_size: byteSize === null ? null : Math.trunc(byteSize),
        uploaded_by: staff.uid,
        title: trimmedOrNull(jsonText(att.title)),
        kind: trimmedOrNull(jsonText(att.kind)),
        captured_at: capturedAt ? Timestamp.fromDate(capturedAt) : null,
        source: trimmedOrNull(jsonText(att.source)) ?? "admin_upload",
        created_at: nowTs,
      });
    }
    await batch.commit();
  }

  return { ok: true, id: reqRef.id, request_code: code };
});

// ---------------------------------------------------------------------------
// admin_count_requests_by_type
// ---------------------------------------------------------------------------

/** `admin_count_requests_by_type` — total and open count per type, all time. */
export const adminCountRequestsByType = onCall(async (request) => {
  await requireStaff(request, "requests.view");
  const db = getFirestore();
  const typesSnap = await db.collection(COLLECTIONS.requestTypeDefinitions).get();
  const types = [
    ...new Set(
      typesSnap.docs
        .map((doc) => textOf(doc.get("key")) ?? doc.id)
        .filter((key): key is string => key !== null),
    ),
  ];

  const requests = db.collection(COLLECTIONS.requests);
  const results = await Promise.all(
    types.map(async (type) => {
      const [total, pending] = await Promise.all([
        requests.where("request_type", "==", type).count().get(),
        requests
          .where("request_type", "==", type)
          .where("status", "in", BY_TYPE_PENDING_STATUSES)
          .count()
          .get(),
      ]);
      return { type, total: total.data().count, pending: pending.data().count };
    }),
  );

  const counts: Record<string, { total: number; pending: number }> = {};
  for (const row of results) {
    if (row.total > 0) counts[row.type] = { total: row.total, pending: row.pending };
  }
  return { ok: true, counts };
});

// ---------------------------------------------------------------------------
// admin_requests_trend
// ---------------------------------------------------------------------------

/**
 * `admin_requests_trend` — the Reports aggregate over the list's own filter
 * predicate (status included, search unmasked as in the SQL), with rolling
 * 7-day volume buckets counted back from now. The current week lands in
 * `W{weeks}` and the oldest in `W1`; the SQL's `weeks - 1 - weeks_ago` left
 * the newest bucket permanently empty and dropped the oldest week.
 */
export const adminRequestsTrend = onCall(async (request) => {
  await requireStaff(request, "requests.view");
  const data = (request.data ?? {}) as Dict;

  const from = pickInstant(data, "dateFrom", "p_date_from");
  const to = pickInstant(data, "dateTo", "p_date_to");
  const filters = readFilterArgs(data);
  const weeks = Math.max(pickCount(data, 12, "weeks", "p_weeks"), 1);

  const [scanned, departmentSteps] = await Promise.all([
    scanRequests(from, to),
    filters.departmentKey !== null
      ? stepOrdersWhere("role_key", filters.departmentKey)
      : Promise.resolve(null),
  ]);
  const typed = scanned.filter(
    (row) =>
      (filters.type === null || textOf(row.data.request_type) === filters.type) &&
      (filters.status === null || statusOf(row) === filters.status),
  );
  const senders = await loadSenders(typed);
  const filtered = typed.filter(
    (row) =>
      inZone(row, senders, filters.zoneId) &&
      inDepartment(row, filters.departmentKey, departmentSteps) &&
      matchesSearch(row, senders, filters.search, false),
  );

  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const buckets = new Map<number, number>();
  let pendingAck = 0;
  let approved = 0;
  let rejected = 0;
  const now = Date.now();

  for (const row of filtered) {
    const type = textOf(row.data.request_type) ?? "";
    const status = statusOf(row);
    byType[type] = (byType[type] ?? 0) + 1;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const payload = (row.data.payload ?? {}) as Dict;
    if (boolOf(payload.awaiting_driver_ack)) pendingAck += 1;
    if (status === "approved") approved += 1;
    if (status === "rejected") rejected += 1;
    if (row.createdAt !== null && row.createdAt.getTime() <= now) {
      const weeksAgo = Math.floor((now - row.createdAt.getTime()) / 1000 / WEEK_SECONDS);
      if (weeksAgo < weeks) {
        const idx = weeks - weeksAgo;
        buckets.set(idx, (buckets.get(idx) ?? 0) + 1);
      }
    }
  }

  const volume: Array<{ label: string; count: number }> = [];
  for (let idx = 1; idx <= weeks; idx += 1) {
    volume.push({ label: `W${idx}`, count: buckets.get(idx) ?? 0 });
  }

  return {
    ok: true,
    total: filtered.length,
    pending_ack: pendingAck,
    approved,
    rejected,
    by_type: byType,
    by_status: byStatus,
    volume,
  };
});

// ---------------------------------------------------------------------------
// admin_request_department_report
// ---------------------------------------------------------------------------

/**
 * `admin_request_department_report` — per department (the step's `role_key`),
 * the requests that reached it, its approvals / rejections, and the mean time a
 * request waited on that department's own step.
 */
export const adminRequestDepartmentReport = onCall(async (request) => {
  await requireStaff(request, "requests.view");
  const data = (request.data ?? {}) as Dict;
  const from = pickInstant(data, "dateFrom", "p_date_from");
  const to = pickInstant(data, "dateTo", "p_date_to");

  const [requests, labels] = await Promise.all([scanRequests(from, to), loadDepartmentLabels()]);
  const stepsByRequest = await loadStepsFor(requests.map((row) => row.id));

  type Agg = { requests: Set<string>; approved: number; rejected: number; waits: number[] };
  const aggs = new Map<string, Agg>();

  for (const row of requests) {
    const steps = [...(stepsByRequest.get(row.id) ?? [])]
      .filter((step) => intOf(step.step_order) !== null)
      .sort((a, b) => (intOf(a.step_order) ?? 0) - (intOf(b.step_order) ?? 0));
    const currentOrder = intOf(row.data.current_step_order);
    let maxDecided: number | null = null;

    for (const step of steps) {
      const order = intOf(step.step_order) as number;
      const decidedAt = instantOf(step.decided_at);
      const enteredAt = maxDecided ?? row.createdAt?.getTime() ?? null;
      const roleKey = textOf(step.role_key);
      const reached = currentOrder === null || order <= currentOrder;

      // The SQL window runs after its WHERE, so only counted steps feed `entered_at`.
      if (!roleKey || roleKey === "system" || !reached) continue;

      const agg = aggs.get(roleKey) ?? { requests: new Set(), approved: 0, rejected: 0, waits: [] };
      agg.requests.add(row.id);
      if (step.status === "completed") agg.approved += 1;
      if (step.status === "rejected") agg.rejected += 1;
      if (decidedAt !== null && enteredAt !== null) {
        agg.waits.push((decidedAt.getTime() - enteredAt) / 1000);
      }
      aggs.set(roleKey, agg);

      if (decidedAt !== null) {
        maxDecided = maxDecided === null ? decidedAt.getTime() : Math.max(maxDecided, decidedAt.getTime());
      }
    }
  }

  const rows = [...aggs.entries()]
    .map(([key, agg]) => ({
      department_key: key,
      department_label: departmentLabel(labels, key) ?? key,
      requests: agg.requests.size,
      approved: agg.approved,
      rejected: agg.rejected,
      avg_step_seconds: average(agg.waits),
    }))
    .sort((a, b) => {
      if (a.requests !== b.requests) return b.requests - a.requests;
      return a.department_label < b.department_label ? -1 : a.department_label > b.department_label ? 1 : 0;
    });

  return { ok: true, rows };
});
