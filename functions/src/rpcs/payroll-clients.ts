/**
 * Payroll client catalog, its per-month rule list, and the org-wide column
 * config — ports of `admin_payroll_rule_config`, `admin_open_payroll_rule_month`,
 * `admin_save_payroll_client`, `admin_save_payroll_client_rules`,
 * `admin_reset_payroll_client_rules`, `admin_add_payroll_client`,
 * `admin_delete_payroll_client`, `admin_list_payroll_column_config` and
 * `admin_set_payroll_column_config`.
 *
 * A client is `drivers.project_key` (Americana, Keeta, …). Hours, criteria ticks
 * and zone thresholds are one row per client; the rule list is versioned per
 * client + month. The rules that apply to a month are that month's rows, else the
 * most recent earlier month, else the SOP defaults — which is why a month that was
 * never opened still resolves.
 */
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "../core/collections";
import { kuwaitDayString, monthKey, parseMonthKey } from "../core/kuwait";
import { requireStaff, type StaffContext } from "../core/staff";

const CLIENT_KEY_RE = /^[a-z0-9_]{1,24}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;
const MONTH_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RULES = 50;
const MAX_CONDITIONS = 8;
const MAX_LABEL = 120;
const AUDIT_LIMIT = 100;
const RULE_KINDS = ["12", "3H", "HALF", "ACT", "ABS", "ALH", "ALO", "CUS"];
const ZONE_CATEGORIES = ["good", "average", "low", "not_set"];
const CONDITION_FIELDS = ["zone_category", "zone", "orders", "hours"];
const PAYROLL_COLUMN_KEYS = [
  "amId",
  "mgId",
  "name",
  "zone",
  "zoneCategory",
  "partner",
  "vehicleKind",
  "finalOrders",
  "actualHours",
];
const HEADING_VIEWS = ["combined", "ao"];

type Dict = Record<string, unknown>;
type RuleInput = { sortOrder: number; label: string; conditions: unknown[]; result: Dict };

/** A SQL `date` has no Firestore twin, so the month is the stored string. */
const monthDay = (key: string): string => `${key}-01`;

// --- argument parsing --------------------------------------------------------

function pick(data: Dict, ...names: string[]): unknown {
  for (const name of names) {
    const value = data[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function pickText(data: Dict, ...names: string[]): string | null {
  const value = pick(data, ...names);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function pickCount(data: Dict, fallback: number, ...names: string[]): number {
  const value = pick(data, ...names);
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
}

function pickNumber(data: Dict, fallback: number, ...names: string[]): number {
  const value = pick(data, ...names);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function pickBool(data: Dict, fallback: boolean, ...names: string[]): boolean {
  for (const name of names) {
    const value = data[name];
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return fallback;
}

function pickList(data: Dict, ...names: string[]): unknown[] | null {
  const value = pick(data, ...names);
  return Array.isArray(value) ? value : null;
}

/** The callable argument object, or `{}` when the caller sent nothing usable. */
function argDict(request: CallableRequest<unknown>): Dict {
  const data = request.data;
  return typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Dict) : {};
}

// --- Kuwait month window -----------------------------------------------------

function currentKuwaitMonth(): string {
  return kuwaitDayString(new Date()).slice(0, 7);
}

function monthIndex(key: string): number {
  const { year, month } = parseMonthKey(key);
  return year * 12 + (month - 1);
}

function normaliseMonth(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (MONTH_KEY_RE.test(value)) return value;
  if (MONTH_DAY_RE.test(value)) return value.slice(0, 7);
  return null;
}

/**
 * Same window the Payroll page allows, so a rule month can never be one the grid
 * cannot show: the current Kuwait month or one of the two before it.
 */
function assertRuleMonth(raw: string | null): string {
  const key = normaliseMonth(raw);
  if (!key) throw new HttpsError("invalid-argument", "invalid_month");
  const current = monthIndex(currentKuwaitMonth());
  const target = monthIndex(key);
  if (target > current || target < current - 2) {
    throw new HttpsError("failed-precondition", "month_out_of_range");
  }
  return key;
}

/** The month a client delete is audited against when no month was named. */
function middleKuwaitMonth(): string {
  const { year, month } = parseMonthKey(currentKuwaitMonth());
  const index = year * 12 + (month - 1);
  return monthKey(Math.floor(index / 12), (index % 12) + 1);
}

// --- rule validation (port of payroll_validate_rule) -------------------------

function validateRule(raw: unknown): Dict {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new HttpsError("invalid-argument", "invalid_rule");
  }
  const rule = raw as Dict;

  const conditionsRaw = rule.conditions ?? rule.all;
  const conditions = Array.isArray(conditionsRaw) ? conditionsRaw : [];
  // A rule with no condition would match every day and silently swallow the rules
  // below it; the client default is where "nothing matched" belongs.
  if (conditions.length === 0) throw new HttpsError("invalid-argument", "rule_condition_required");
  if (conditions.length > MAX_CONDITIONS) {
    throw new HttpsError("invalid-argument", "too_many_conditions");
  }

  for (const condition of conditions) {
    if (typeof condition !== "object" || condition === null) {
      throw new HttpsError("invalid-argument", "invalid_rule");
    }
    const cond = condition as Dict;
    const field = typeof cond.field === "string" ? cond.field : "";
    const op = typeof cond.op === "string" ? cond.op : "";
    if (!CONDITION_FIELDS.includes(field)) {
      throw new HttpsError("invalid-argument", `invalid_rule_field:${field}`);
    }
    const value = cond.value;
    if (field === "zone_category" || field === "zone") {
      if (!["eq", "neq", "in", "not_in"].includes(op)) {
        throw new HttpsError("invalid-argument", `invalid_rule_operator:${op}`);
      }
      if (value === undefined || value === null) {
        throw new HttpsError("invalid-argument", "rule_value_required");
      }
      if (field !== "zone_category") continue;
      const listed = Array.isArray(value) ? value : [value];
      for (const item of listed) {
        const category = typeof item === "string" ? item.trim().toLowerCase() : "";
        if (!ZONE_CATEGORIES.includes(category)) {
          throw new HttpsError("invalid-argument", "invalid_zone_category");
        }
      }
      continue;
    }
    if (!["lt", "lte", "gt", "gte", "eq", "neq"].includes(op)) {
      throw new HttpsError("invalid-argument", `invalid_rule_operator:${op}`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new HttpsError("invalid-argument", "rule_value_number_required");
    }
    if (value < 0 || value > 100_000) {
      throw new HttpsError("invalid-argument", "rule_value_out_of_range");
    }
  }

  // The result may ride the rule (`{conditions, result}`) or the rule *is* the
  // result (`{kind, hours}`) — the SQL accepted both, so both stay valid.
  const resultSource = rule.result;
  const result =
    typeof resultSource === "object" && resultSource !== null && !Array.isArray(resultSource)
      ? (resultSource as Dict)
      : rule;
  const kindRaw = typeof result.kind === "string" ? result.kind.trim().toUpperCase() : "";
  if (!RULE_KINDS.includes(kindRaw)) {
    throw new HttpsError("invalid-argument", `invalid_rule_result:${kindRaw}`);
  }
  const kind = kindRaw === "3H" ? "3h" : kindRaw;
  if (kind !== "CUS") return { kind, hours: null };

  const hours = Number(result.hours);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
    throw new HttpsError("invalid-argument", "invalid_custom_hours");
  }
  return { kind, hours };
}

// --- SOP defaults (port of payroll_default_rules) ----------------------------

function condition(field: string, op: string, value: unknown): Dict {
  return { field, op, value };
}

function defaultRule(sortOrder: number, label: string, conditions: Dict[], kind: string): Dict {
  return { sort_order: sortOrder, label, conditions, result: { kind } };
}

const DEFAULT_RULES: Record<string, Dict[]> = {
  americana: [
    defaultRule(10, "Orders less than 1", [condition("orders", "lt", 1)], "ABS"),
    defaultRule(20, "Zone Khiran (low-volume zone)", [condition("zone", "eq", "Khiran")], "12"),
    defaultRule(
      30,
      "Low zone and orders less than 5",
      [condition("zone_category", "eq", "low"), condition("orders", "lt", 5)],
      "3h",
    ),
    defaultRule(
      40,
      "Good or Average zone and orders less than 7",
      [condition("zone_category", "in", ["good", "average"]), condition("orders", "lt", 7)],
      "3h",
    ),
  ],
  keeta: [
    defaultRule(
      10,
      "No worked hours and no orders",
      [condition("hours", "lt", 0.5), condition("orders", "lt", 1)],
      "ABS",
    ),
    defaultRule(20, "Orders less than 3", [condition("orders", "lt", 3)], "ALO"),
    defaultRule(30, "Worked hours less than 4", [condition("hours", "lt", 4)], "ALH"),
    defaultRule(
      40,
      "Under 6 hours and 6 orders or more",
      [condition("hours", "lt", 6), condition("orders", "gte", 6)],
      "HALF",
    ),
    defaultRule(
      50,
      "10 to 12 hours and 6 orders or more",
      [
        condition("hours", "gte", 10),
        condition("hours", "lte", 12),
        condition("orders", "gte", 6),
      ],
      "ACT",
    ),
    defaultRule(
      60,
      "10 to 12 hours and orders under 6",
      [condition("hours", "gte", 10), condition("hours", "lte", 12), condition("orders", "lt", 6)],
      "HALF",
    ),
    defaultRule(70, "More than 12 hours", [condition("hours", "gt", 12)], "12"),
  ],
};

function defaultRulesFor(clientKey: string): Dict[] {
  return DEFAULT_RULES[clientKey] ?? [];
}

// --- Firestore reads and writes ---------------------------------------------

type RuleRow = {
  client_key: string;
  period_month: string;
  sort_order: number;
  label: string;
  conditions: unknown[];
  result: Dict;
};

const clientRef = (db: Firestore, key: string) =>
  db.collection(COLLECTIONS.payrollClients).doc(key);

/** The sort order is unique per (client, month), so it can be part of the doc id. */
const ruleDocId = (clientKey: string, periodMonth: string, sortOrder: number) =>
  `${clientKey}__${periodMonth}__${sortOrder}`;

function ruleRowOf(docId: string, data: Dict): RuleRow {
  const conditions = data.conditions;
  const result = data.result;
  return {
    client_key: typeof data.client_key === "string" ? data.client_key : (docId.split("__")[0] ?? ""),
    period_month: typeof data.period_month === "string" ? data.period_month : "",
    sort_order: typeof data.sort_order === "number" ? data.sort_order : 0,
    label: typeof data.label === "string" ? data.label : "",
    conditions: Array.isArray(conditions) ? conditions : [],
    result:
      typeof result === "object" && result !== null && !Array.isArray(result)
        ? (result as Dict)
        : {},
  };
}

async function readRules(db: Firestore, clientKey: string, periodMonth: string): Promise<RuleRow[]> {
  const snap = await db
    .collection(COLLECTIONS.payrollClientRules)
    .where("client_key", "==", clientKey)
    .where("period_month", "==", periodMonth)
    .get();
  return snap.docs
    .map((doc) => ruleRowOf(doc.id, (doc.data() ?? {}) as Dict))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** The rows that actually apply to a month: its own, else the newest earlier month. */
async function effectiveRules(db: Firestore, clientKey: string, month: string): Promise<RuleRow[]> {
  const period = await latestRuleMonth(db, clientKey, month);
  if (!period) return [];
  return readRules(db, clientKey, monthDay(period));
}

/** The most recent month at or before `month` that has rows — `max(period_month)`. */
async function latestRuleMonth(db: Firestore, clientKey: string, month: string): Promise<string | null> {
  const snap = await db
    .collection(COLLECTIONS.payrollClientRules)
    .where("client_key", "==", clientKey)
    .where("period_month", "<=", monthDay(month))
    .orderBy("period_month", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  const period = (snap.docs[0].data() ?? {}).period_month;
  return typeof period === "string" && period.length >= 7 ? period.slice(0, 7) : null;
}

/** `SELECT count(*) FROM drivers WHERE project_key = key AND archived_at IS NULL`. */
async function clientRiderCount(db: Firestore, key: string): Promise<number> {
  const snap = await db
    .collection(COLLECTIONS.drivers)
    .where("project_key", "==", key)
    .where("archived_at", "==", null)
    .count()
    .get();
  return snap.data().count;
}

/** The audit row's actor name, the way `payroll_log_rule_change` read it. */
async function actorName(db: Firestore, uid: string): Promise<string> {
  const snap = await db.collection(COLLECTIONS.profiles).doc(uid).get();
  const name = (snap.data() ?? {}).full_name;
  if (typeof name !== "string") return "Unknown";
  const trimmed = name.trim();
  return trimmed.length ? trimmed : "Unknown";
}

async function logRuleChange(args: {
  actor: StaffContext;
  clientKey: string;
  periodMonth: string | null;
  entity: string;
  action: string;
  before: unknown;
  after: unknown;
}): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTIONS.payrollRuleAuditLogs).add({
    client_key: args.clientKey,
    period_month: args.periodMonth,
    entity: args.entity,
    action: args.action,
    actor_id: args.actor.uid,
    actor_name: await actorName(db, args.actor.uid),
    before: args.before ?? null,
    after: args.after ?? null,
    created_at: FieldValue.serverTimestamp(),
  });
}

/** The panel gates payroll writes on `payroll.manage`; SQL called `payroll_can_manage()`. */
function canManagePayroll(staff: StaffContext): boolean {
  if (staff.isSuperAdmin || staff.isManager) return true;
  return (
    staff.permissionSlugs.has("payroll.manage") ||
    staff.permissionSlugs.has("payroll.edit") ||
    staff.permissionSlugs.has("payroll.create")
  );
}

function requirePayrollManager(staff: StaffContext): void {
  if (!canManagePayroll(staff)) throw new HttpsError("permission-denied", "not_authorized");
}

/** The audit stamp's `to_char(created_at AT TIME ZONE 'Asia/Kuwait','YYYY-MM-DD HH24:MI')`. */
function kuwaitMinuteString(value: unknown): string {
  const date = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const at = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${at("year")}-${at("month")}-${at("day")} ${at("hour")}:${at("minute")}`;
}

// --- config payload (port of admin_payroll_rule_config) ----------------------

async function buildRuleConfig(month: string, staff: StaffContext): Promise<Dict> {
  const db = getFirestore();
  const periodMonth = monthDay(month);

  const clientsSnap = await db
    .collection(COLLECTIONS.payrollClients)
    .where("is_active", "==", true)
    .orderBy("sort_order")
    .get();

  const clients = await Promise.all(
    clientsSnap.docs.map(async (doc) => {
      const data = (doc.data() ?? {}) as Dict;
      const [riderCount, effectiveMonth, monthRules] = await Promise.all([
        clientRiderCount(db, doc.id),
        latestRuleMonth(db, doc.id, month),
        db
          .collection(COLLECTIONS.payrollClientRules)
          .where("client_key", "==", doc.id)
          .where("period_month", "==", periodMonth)
          .limit(1)
          .get(),
      ]);
      return {
        key: doc.id,
        name: typeof data.name === "string" ? data.name : doc.id,
        usesZone: data.uses_zone === true,
        usesOrders: data.uses_orders !== false,
        usesHours: data.uses_hours === true,
        fullDayHours: typeof data.full_day_hours === "number" ? data.full_day_hours : 12,
        halfDayHours: typeof data.half_day_hours === "number" ? data.half_day_hours : 6,
        reducedHours: typeof data.reduced_hours === "number" ? data.reduced_hours : 3,
        requiredHoursPerDay:
          typeof data.required_hours_per_day === "number" ? data.required_hours_per_day : 12,
        defaultOffDays: typeof data.default_off_days === "number" ? data.default_off_days : 2,
        defaultResult: data.default_result ?? { kind: "12", hours: null },
        goodThreshold: typeof data.good_threshold === "number" ? data.good_threshold : 110,
        averageThreshold: typeof data.average_threshold === "number" ? data.average_threshold : 70,
        isSystem: data.is_system === true,
        sortOrder: typeof data.sort_order === "number" ? data.sort_order : 100,
        riderCount,
        effectiveMonth: effectiveMonth ? monthDay(effectiveMonth) : null,
        hasRulesForMonth: !monthRules.empty,
      };
    }),
  );

  const activeKeys = new Set(clients.map((client) => client.key));
  const monthRuleSnap = await db
    .collection(COLLECTIONS.payrollClientRules)
    .where("period_month", "==", periodMonth)
    .get();
  const rules = monthRuleSnap.docs
    .map((doc) => ruleRowOf(doc.id, (doc.data() ?? {}) as Dict))
    .filter((row) => activeKeys.has(row.client_key))
    .sort((a, b) =>
      a.client_key === b.client_key
        ? a.sort_order - b.sort_order
        : a.client_key.localeCompare(b.client_key),
    )
    .map((row) => ({
      clientKey: row.client_key,
      periodMonth: row.period_month,
      sortOrder: row.sort_order,
      label: row.label,
      conditions: row.conditions,
      result: row.result,
    }));

  const auditSnap = await db
    .collection(COLLECTIONS.payrollRuleAuditLogs)
    .orderBy("created_at", "desc")
    .limit(AUDIT_LIMIT)
    .get();
  const audit = auditSnap.docs.map((doc) => {
    const data = (doc.data() ?? {}) as Dict;
    return {
      id: doc.id,
      clientKey: typeof data.client_key === "string" ? data.client_key : null,
      periodMonth: typeof data.period_month === "string" ? data.period_month : null,
      entity: typeof data.entity === "string" ? data.entity : "",
      action: typeof data.action === "string" ? data.action : "",
      actorName: typeof data.actor_name === "string" ? data.actor_name : "—",
      createdAt: kuwaitMinuteString(data.created_at),
      before: data.before ?? null,
      after: data.after ?? null,
    };
  });

  return { month: periodMonth, canManage: canManagePayroll(staff), clients, rules, audit };
}

// --- callables ---------------------------------------------------------------

/** `admin_payroll_rule_config` — the Settings tab and zone panel payload for a month. */
export const adminPayrollRuleConfig = onCall(async (request) => {
  const staff = await requireStaff(request, "payroll.view");
  const month = assertRuleMonth(pickText(argDict(request), "p_month", "month", "monthKey"));
  return buildRuleConfig(month, staff);
});

/**
 * `admin_open_payroll_rule_month` — materialise every active client that has no
 * rows for the month, copying the newest earlier month, else the SOP defaults.
 * Idempotent, so the Settings tab can call it on every open.
 */
export const adminOpenPayrollRuleMonth = onCall(async (request) => {
  const staff = await requireStaff(request, "payroll.manage");
  requirePayrollManager(staff);
  const month = assertRuleMonth(pickText(argDict(request), "p_month", "month", "monthKey"));
  const periodMonth = monthDay(month);
  const db = getFirestore();

  const clientsSnap = await db
    .collection(COLLECTIONS.payrollClients)
    .where("is_active", "==", true)
    .orderBy("sort_order")
    .get();

  for (const doc of clientsSnap.docs) {
    const existing = await db
      .collection(COLLECTIONS.payrollClientRules)
      .where("client_key", "==", doc.id)
      .where("period_month", "==", periodMonth)
      .limit(1)
      .get();
    if (!existing.empty) continue;

    const carried = await effectiveRules(db, doc.id, month);
    const next: RuleRow[] = carried.length
      ? carried.map((row) => ({ ...row, period_month: periodMonth }))
      : defaultRulesFor(doc.id).map((raw, index) => ({
          client_key: doc.id,
          period_month: periodMonth,
          sort_order: typeof raw.sort_order === "number" ? raw.sort_order : (index + 1) * 10,
          label: typeof raw.label === "string" ? raw.label : "",
          conditions: Array.isArray(raw.conditions) ? raw.conditions : [],
          result:
            typeof raw.result === "object" && raw.result !== null && !Array.isArray(raw.result)
              ? (raw.result as Dict)
              : {},
        }));
    if (!next.length) continue;

    const batch = db.batch();
    for (const row of next) {
      batch.set(
        db
          .collection(COLLECTIONS.payrollClientRules)
          .doc(ruleDocId(doc.id, periodMonth, row.sort_order)),
        {
          client_key: doc.id,
          period_month: periodMonth,
          sort_order: row.sort_order,
          label: row.label,
          conditions: row.conditions,
          result: row.result,
          updated_at: FieldValue.serverTimestamp(),
        },
      );
    }
    await batch.commit();
  }

  return buildRuleConfig(month, staff);
});

/** `admin_save_payroll_client` — upsert one client row (hours, ticks, thresholds). */
export const adminSavePayrollClient = onCall(async (request) => {
  const staff = await requireStaff(request, "payroll.manage");
  requirePayrollManager(staff);
  const data = argDict(request);
  const db = getFirestore();

  const key = (pickText(data, "p_key", "key") ?? "").toLowerCase().trim();
  const name = (pickText(data, "p_name", "name") ?? "").trim();
  if (!CLIENT_KEY_RE.test(key)) throw new HttpsError("invalid-argument", "invalid_client_key");
  if (!name || name.length > MAX_LABEL) {
    throw new HttpsError("invalid-argument", "invalid_client_name");
  }

  const defaultResult = validateRule({
    conditions: [condition("orders", "lt", 0)],
    result: { kind: pickText(data, "p_default_result", "defaultResult") ?? "12" },
  });

  const ref = clientRef(db, key);
  const existing = await ref.get();
  const before = existing.exists ? ((existing.data() ?? {}) as Dict) : null;

  const sortOrderRaw = pick(data, "p_sort_order", "sortOrder");
  const sortOrder =
    typeof sortOrderRaw === "number" && Number.isFinite(sortOrderRaw)
      ? Math.trunc(sortOrderRaw)
      : null;

  const row: Dict = {
    name,
    uses_zone: pickBool(data, false, "p_uses_zone", "usesZone"),
    uses_orders: pickBool(data, true, "p_uses_orders", "usesOrders"),
    uses_hours: pickBool(data, false, "p_uses_hours", "usesHours"),
    full_day_hours: pickNumber(data, 12, "p_full_day_hours", "fullDayHours"),
    half_day_hours: pickNumber(data, 6, "p_half_day_hours", "halfDayHours"),
    reduced_hours: pickNumber(data, 3, "p_reduced_hours", "reducedHours"),
    required_hours_per_day: pickNumber(data, 12, "p_required_hours_per_day", "requiredHoursPerDay"),
    default_off_days: pickCount(data, 2, "p_default_off_days", "defaultOffDays"),
    default_result: defaultResult,
    good_threshold: pickNumber(data, 110, "p_good_threshold", "goodThreshold"),
    average_threshold: pickNumber(data, 70, "p_average_threshold", "averageThreshold"),
    // is_system / is_active are not panel-editable; they survive an edit.
    is_system: before?.is_system === true,
    is_active: before?.is_active !== false,
    // `COALESCE(p_sort_order, c.sort_order)`: an omitted order never resets to 100.
    sort_order: sortOrder ?? (typeof before?.sort_order === "number" ? before.sort_order : 100),
    updated_at: FieldValue.serverTimestamp(),
  };

  if (existing.exists) {
    await ref.set(row, { merge: true });
  } else {
    await ref.set({ ...row, created_at: FieldValue.serverTimestamp() });
  }

  const after = ((await ref.get()).data() ?? {}) as Dict;
  await logRuleChange({
    actor: staff,
    clientKey: key,
    periodMonth: null,
    entity: "client",
    action: before ? "update" : "create",
    before,
    after: { ...after, key },
  });

  return { ...after, key };
});

/**
 * `admin_save_payroll_client_rules` — replaces the whole list for one client and
 * month in one transaction, so a reorder cannot half-apply, and one audit row
 * carries the full before/after.
 */
export const adminSavePayrollClientRules = onCall(async (request) => {
  const staff = await requireStaff(request, "payroll.manage");
  requirePayrollManager(staff);
  const data = argDict(request);
  const db = getFirestore();

  const clientKey = (pickText(data, "p_client_key", "clientKey", "key") ?? "").toLowerCase();
  if (!clientKey) throw new HttpsError("invalid-argument", "unknown_client");
  if (!(await clientRef(db, clientKey).get()).exists) {
    throw new HttpsError("failed-precondition", "unknown_client");
  }

  const month = assertRuleMonth(pickText(data, "p_month", "month", "monthKey"));
  const periodMonth = monthDay(month);

  const rawRules = pickList(data, "p_rules", "rules") ?? [];
  if (rawRules.length > MAX_RULES) throw new HttpsError("invalid-argument", "too_many_rules");

  const parsed: RuleInput[] = [];
  const seen = new Set<number>();
  rawRules.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new HttpsError("invalid-argument", "invalid_rules");
    }
    const rule = raw as Dict;
    const result = validateRule(rule);
    const orderRaw = pick(rule, "sortOrder", "sort_order");
    const order =
      typeof orderRaw === "number" && Number.isFinite(orderRaw)
        ? Math.trunc(orderRaw)
        : (index + 1) * 10;
    if (order < 0 || order > 9999) throw new HttpsError("invalid-argument", "invalid_rule_order");
    if (seen.has(order)) throw new HttpsError("invalid-argument", "duplicate_rule_order");
    seen.add(order);
    const conditionsRaw = rule.conditions ?? rule.all;
    parsed.push({
      sortOrder: order,
      label: typeof rule.label === "string" ? rule.label.trim().slice(0, MAX_LABEL) : "",
      conditions: Array.isArray(conditionsRaw) ? conditionsRaw : [],
      result,
    });
  });

  const before = await readRules(db, clientKey, periodMonth);

  await db.runTransaction(async (tx) => {
    const collection = db.collection(COLLECTIONS.payrollClientRules);
    const current = await tx.get(
      collection.where("client_key", "==", clientKey).where("period_month", "==", periodMonth),
    );
    for (const doc of current.docs) tx.delete(doc.ref);
    for (const rule of parsed) {
      tx.set(collection.doc(ruleDocId(clientKey, periodMonth, rule.sortOrder)), {
        client_key: clientKey,
        period_month: periodMonth,
        sort_order: rule.sortOrder,
        label: rule.label,
        conditions: rule.conditions,
        result: rule.result,
        updated_at: FieldValue.serverTimestamp(),
      });
    }
  });

  const after = await readRules(db, clientKey, periodMonth);
  if (ruleShape(before) !== ruleShape(after)) {
    await logRuleChange({
      actor: staff,
      clientKey,
      periodMonth,
      entity: "rules",
      action: "update",
      before,
      after,
    });
  }

  return buildRuleConfig(month, staff);
});

/** The `after IS DISTINCT FROM before` comparison, on the fields that are stored. */
function ruleShape(rows: RuleRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      client_key: row.client_key,
      period_month: row.period_month,
      sort_order: row.sort_order,
      label: row.label,
      conditions: row.conditions,
      result: row.result,
    })),
  );
}

/** `admin_reset_payroll_client_rules` — restore the SOP starting rules for the month. */
export const adminResetPayrollClientRules = onCall(async (request) => {
  const staff = await requireStaff(request, "payroll.manage");
  requirePayrollManager(staff);
  const data = argDict(request);
  const db = getFirestore();

  const clientKey = (pickText(data, "p_client_key", "clientKey", "key") ?? "").toLowerCase();
  if (!clientKey) throw new HttpsError("invalid-argument", "unknown_client");
  if (!(await clientRef(db, clientKey).get()).exists) {
    throw new HttpsError("failed-precondition", "unknown_client");
  }

  const month = assertRuleMonth(pickText(data, "p_month", "month", "monthKey"));
  const periodMonth = monthDay(month);
  const defaults = defaultRulesFor(clientKey);
  if (!defaults.length) throw new HttpsError("failed-precondition", "no_default_rules");

  const before = await readRules(db, clientKey, periodMonth);

  await db.runTransaction(async (tx) => {
    const collection = db.collection(COLLECTIONS.payrollClientRules);
    const current = await tx.get(
      collection.where("client_key", "==", clientKey).where("period_month", "==", periodMonth),
    );
    for (const doc of current.docs) tx.delete(doc.ref);
    for (const raw of defaults) {
      const sortOrder = typeof raw.sort_order === "number" ? raw.sort_order : 0;
      tx.set(collection.doc(ruleDocId(clientKey, periodMonth, sortOrder)), {
        client_key: clientKey,
        period_month: periodMonth,
        sort_order: sortOrder,
        label: typeof raw.label === "string" ? raw.label : "",
        conditions: Array.isArray(raw.conditions) ? raw.conditions : [],
        result:
          typeof raw.result === "object" && raw.result !== null && !Array.isArray(raw.result)
            ? (raw.result as Dict)
            : {},
        updated_at: FieldValue.serverTimestamp(),
      });
    }
  });

  await logRuleChange({
    actor: staff,
    clientKey,
    periodMonth,
    entity: "rules",
    action: "update",
    before,
    after: await readRules(db, clientKey, periodMonth),
  });

  return buildRuleConfig(month, staff);
});

/** `admin_add_payroll_client` — derive the key from the name, then optionally copy rules. */
export const adminAddPayrollClient = onCall(async (request) => {
  const staff = await requireStaff(request, "payroll.manage");
  requirePayrollManager(staff);
  const data = argDict(request);
  const db = getFirestore();

  const name = (pickText(data, "p_name", "name") ?? "").trim();
  if (!name || name.length > MAX_LABEL) {
    throw new HttpsError("invalid-argument", "invalid_client_name");
  }

  // The key is derived from the name because `drivers.project_key` is what the
  // rider record stores, so it has to round-trip through that field.
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key || key.length > 24) throw new HttpsError("invalid-argument", "invalid_client_key");

  const copyFrom = (pickText(data, "p_copy_from", "copyFrom") ?? "").toLowerCase();
  if (copyFrom && copyFrom === key) throw new HttpsError("invalid-argument", "client_key_taken");

  const ref = clientRef(db, key);
  if ((await ref.get()).exists) throw new HttpsError("failed-precondition", "client_key_taken");

  const allClients = await db.collection(COLLECTIONS.payrollClients).get();
  let base = 100;
  for (const doc of allClients.docs) {
    const order = (doc.data() ?? {}).sort_order;
    if (typeof order === "number" && Number.isFinite(order)) base = Math.max(base, order + 10);
  }

  const monthInput = pickText(data, "p_month", "month", "monthKey");
  const month = monthInput ? assertRuleMonth(monthInput) : middleKuwaitMonth();
  const periodMonth = monthDay(month);

  const created: Dict = {
    name,
    uses_zone: pickBool(data, false, "p_uses_zone", "usesZone"),
    uses_orders: pickBool(data, true, "p_uses_orders", "usesOrders"),
    uses_hours: pickBool(data, false, "p_uses_hours", "usesHours"),
    full_day_hours: 12,
    half_day_hours: 6,
    reduced_hours: 3,
    required_hours_per_day: 12,
    default_off_days: 2,
    default_result: { kind: "12", hours: null },
    good_threshold: 110,
    average_threshold: 70,
    is_system: false,
    is_active: true,
    sort_order: base,
    created_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  };
  await ref.set(created);

  if (copyFrom) {
    if (!(await clientRef(db, copyFrom).get()).exists) {
      throw new HttpsError("failed-precondition", "unknown_client");
    }
    const carried = await effectiveRules(db, copyFrom, month);
    if (carried.length) {
      const batch = db.batch();
      for (const row of carried) {
        batch.set(
          db
            .collection(COLLECTIONS.payrollClientRules)
            .doc(ruleDocId(key, periodMonth, row.sort_order)),
          {
            client_key: key,
            period_month: periodMonth,
            sort_order: row.sort_order,
            label: row.label,
            conditions: row.conditions,
            result: row.result,
            updated_at: FieldValue.serverTimestamp(),
          },
        );
      }
      await batch.commit();
    }
  }

  await logRuleChange({
    actor: staff,
    clientKey: key,
    periodMonth: null,
    entity: "client",
    action: "create",
    before: null,
    after: { ...created, key },
  });

  return buildRuleConfig(month, staff);
});

/** `admin_delete_payroll_client` — refuses a system client or one still holding riders. */
export const adminDeletePayrollClient = onCall(async (request) => {
  const staff = await requireStaff(request, "payroll.manage");
  requirePayrollManager(staff);
  const data = argDict(request);
  const db = getFirestore();

  const key = (pickText(data, "p_key", "key") ?? "").toLowerCase();
  if (!key) throw new HttpsError("invalid-argument", "unknown_client");

  const ref = clientRef(db, key);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "unknown_client");

  const before = (snap.data() ?? {}) as Dict;
  if (before.is_system === true) throw new HttpsError("failed-precondition", "system_client");

  const [riders, intakes] = await Promise.all([
    db.collection(COLLECTIONS.drivers).where("project_key", "==", key).limit(1).get(),
    db.collection(COLLECTIONS.driverIntakes).where("project_key", "==", key).limit(1).get(),
  ]);
  if (!riders.empty || !intakes.empty) {
    throw new HttpsError("failed-precondition", "client_has_riders");
  }

  await ref.delete();

  await logRuleChange({
    actor: staff,
    clientKey: key,
    periodMonth: monthDay(middleKuwaitMonth()),
    entity: "client",
    action: "delete",
    before,
    after: null,
  });

  return { ok: true, key };
});

/** `admin_list_payroll_column_config` — one row per stored identity heading. */
export const adminListPayrollColumnConfig = onCall(async (request) => {
  await requireStaff(request, "payroll.view");
  const snap = await getFirestore().collection(COLLECTIONS.payrollColumnConfig).get();
  return snap.docs
    .map((doc) => {
      const data = (doc.data() ?? {}) as Dict;
      const hidden = Array.isArray(data.hidden_views) ? data.hidden_views : [];
      return {
        column_key: doc.id,
        label: typeof data.label === "string" && data.label.trim() !== "" ? data.label : null,
        hidden_views: hidden.filter(
          (view): view is string => typeof view === "string" && HEADING_VIEWS.includes(view),
        ),
      };
    })
    .sort((a, b) => a.column_key.localeCompare(b.column_key));
});

/**
 * `admin_set_payroll_column_config` — a heading with no label and no hidden view
 * has nothing to store, so that combination deletes the row instead of writing an
 * empty one (the SQL's `DELETE` after the upsert).
 */
export const adminSetPayrollColumnConfig = onCall(async (request) => {
  const staff = await requireStaff(request, "payroll.manage");
  requirePayrollManager(staff);
  const data = argDict(request);

  const columnKey = pickText(data, "p_column_key", "columnKey");
  if (!columnKey || !PAYROLL_COLUMN_KEYS.includes(columnKey)) {
    throw new HttpsError("invalid-argument", "invalid_column");
  }

  const labelRaw = pickText(data, "p_label", "label");
  const label = labelRaw && labelRaw.trim() !== "" ? labelRaw.trim() : null;
  const hiddenRaw = pickList(data, "p_hidden_views", "hiddenViews") ?? [];
  const hidden: string[] = [];
  for (const view of hiddenRaw) {
    if (typeof view !== "string" || !HEADING_VIEWS.includes(view)) {
      throw new HttpsError("invalid-argument", "invalid_view");
    }
    if (!hidden.includes(view)) hidden.push(view);
  }

  const ref = getFirestore().collection(COLLECTIONS.payrollColumnConfig).doc(columnKey);
  if (label === null && hidden.length === 0) {
    await ref.delete();
    return { columnKey, label: null, hiddenViews: [] };
  }

  await ref.set(
    {
      label,
      hidden_views: hidden,
      updated_at: FieldValue.serverTimestamp(),
      updated_by: staff.uid,
    },
    { merge: true },
  );

  return { columnKey, label, hiddenViews: hidden };
});
