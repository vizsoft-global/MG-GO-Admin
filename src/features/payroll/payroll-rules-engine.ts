import {
  PAYROLL_DAY_HOURS,
  PAYROLL_DEFAULT_OFF_DAYS,
  type DayStatus,
} from "./payroll-formulas";

/**
 * MGGO Payroll SOP v4.0 — the attendance rule engine.
 *
 * Pure and synchronous, so the grid, the CSV, the Attendance and Orders tab,
 * the Settings "Try the rules" simulator and the unit tests all ask the same
 * function the same question. A threshold that lived in two places would drift.
 *
 * Precedence, exactly SOP section 7:
 *   manual adjustment
 *     > Operations (OFF / Sick / Accident / Vehicle issue)
 *       > first matching client rule
 *         > client default
 *           > legacy fallback (today's check-in classification)
 */

/* ------------------------------------------------------------------ */
/* Rule shape                                                          */
/* ------------------------------------------------------------------ */

export const RULE_FIELDS = ["zone_category", "zone", "orders", "hours"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const RULE_NUMERIC_OPS = ["lt", "lte", "gt", "gte", "eq", "neq"] as const;
export const RULE_SET_OPS = ["in", "not_in"] as const;
export type RuleOp = (typeof RULE_NUMERIC_OPS)[number] | (typeof RULE_SET_OPS)[number];

/** The SOP's result codes, verbatim. */
export const RULE_RESULT_KINDS = ["12", "3h", "HALF", "ACT", "ABS", "ALH", "ALO", "CUS"] as const;
export type RuleResultKind = (typeof RULE_RESULT_KINDS)[number];

export const RULE_RESULT_LABEL: Record<RuleResultKind, string> = {
  "12": "Full day · 12 h",
  "3h": "Reduced day · 3 h",
  HALF: "Half day · 6 h",
  ACT: "Actual hours",
  ABS: "Absent",
  ALH: "Absent · LH",
  ALO: "Absent · LO",
  CUS: "Custom hours",
};

/** The SOP's day-type list, which is also the adjustment picker's status list. */
export const ADJUSTMENT_STATUSES = [
  "auto",
  "12",
  "3h",
  "half",
  "actual",
  "off",
  "absent",
  "abs_lh",
  "abs_lo",
  "sick",
  "accident",
  "vehicle",
  "custom",
] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export type ZoneCategory = "good" | "average" | "low" | "not_set";

export type PayrollRuleCondition = {
  field: RuleField;
  op: RuleOp;
  value: string | number | readonly string[];
};

export type PayrollRuleResult = {
  kind: RuleResultKind;
  /** Only meaningful for CUS. */
  hours?: number | null;
};

export type PayrollRule = {
  clientKey: string;
  /** The month the rule list was saved for. */
  periodMonth: string;
  sortOrder: number;
  label: string;
  conditions: PayrollRuleCondition[];
  result: PayrollRuleResult;
};

export type PayrollClientConfig = {
  key: string;
  name: string;
  usesZone: boolean;
  usesOrders: boolean;
  usesHours: boolean;
  fullDayHours: number;
  halfDayHours: number;
  reducedHours: number;
  requiredHoursPerDay: number;
  defaultOffDays: number;
  defaultResult: PayrollRuleResult;
  goodThreshold: number;
  averageThreshold: number;
  isSystem: boolean;
  sortOrder: number;
};

/** Rule kind → the grid's day status. `12` is the existing `work`, so a legacy
 *  month's numbers do not move when a client rule says "full day". */
export const RULE_KIND_TO_STATUS: Record<RuleResultKind, DayStatus> = {
  "12": "work",
  "3h": "reduced3",
  HALF: "half",
  ACT: "actual",
  ABS: "absent",
  ALH: "abs_lh",
  ALO: "abs_lo",
  CUS: "custom",
};

export const ADJUSTMENT_STATUS_TO_DAY: Record<Exclude<AdjustmentStatus, "auto">, DayStatus> = {
  "12": "work",
  "3h": "reduced3",
  half: "half",
  actual: "actual",
  off: "off",
  absent: "absent",
  abs_lh: "abs_lh",
  abs_lo: "abs_lo",
  sick: "sick",
  accident: "accident",
  vehicle: "vehicle",
  custom: "custom",
};

/* ------------------------------------------------------------------ */
/* Parsing defensively — the rules arrive as jsonb                     */
/* ------------------------------------------------------------------ */

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function normaliseRuleKind(raw: unknown): RuleResultKind | null {
  const kind = String(raw ?? "").trim();
  if (!kind) return null;
  const upper = kind.toUpperCase();
  if (upper === "3H") return "3h";
  if (upper === "HALF") return "HALF";
  if (upper === "12") return "12";
  if (upper === "ACT") return "ACT";
  if (upper === "ABS") return "ABS";
  if (upper === "ALH") return "ALH";
  if (upper === "ALO") return "ALO";
  if (upper === "CUS") return "CUS";
  return null;
}

export function parseRuleResult(raw: unknown): PayrollRuleResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const kind = normaliseRuleKind(obj.kind) ?? "12";
  const hours = asNumber(obj.hours);
  return { kind, hours: kind === "CUS" ? hours : null };
}

export function parseRuleConditions(raw: unknown): PayrollRuleCondition[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: PayrollRuleCondition[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const field = String(o.field ?? "") as RuleField;
    if (!RULE_FIELDS.includes(field)) continue;
    const op = String(o.op ?? "") as RuleOp;
    if (![...RULE_NUMERIC_OPS, ...RULE_SET_OPS].includes(op)) continue;
    const raw = o.value;
    if (["in", "not_in"].includes(op)) {
      const arr = Array.isArray(raw) ? raw : [raw];
      out.push({
        field,
        op,
        value: arr.map((v) => String(v ?? "").trim().toLowerCase()).filter(Boolean),
      });
      continue;
    }
    if (field === "zone") {
      out.push({ field, op: op === "in" || op === "not_in" ? op : "eq", value: String(raw ?? "").trim() });
      continue;
    }
    if (field === "zone_category") {
      out.push({
        field,
        op: op === "in" || op === "not_in" ? op : "eq",
        value: String(raw ?? "").trim().toLowerCase(),
      });
      continue;
    }
    const n = asNumber(raw);
    if (n === null) continue;
    out.push({ field, op, value: n });
  }
  return out;
}

export function parseRule(raw: unknown): PayrollRule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const clientKey = String(o.clientKey ?? o.client_key ?? "").trim();
  if (!clientKey) return null;
  return {
    clientKey,
    periodMonth: String(o.periodMonth ?? o.period_month ?? "").slice(0, 10),
    sortOrder: asNumber(o.sortOrder ?? o.sort_order) ?? 0,
    label: String(o.label ?? ""),
    conditions: parseRuleConditions(o.conditions ?? o.all),
    result: parseRuleResult(o.result),
  };
}

export function parseRules(raw: unknown): PayrollRule[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map(parseRule)
    .filter((r): r is PayrollRule => r !== null)
    .sort((a, b) => {
      if (a.clientKey !== b.clientKey) return a.clientKey.localeCompare(b.clientKey);
      return a.sortOrder - b.sortOrder;
    });
}

/** Rules that apply to one client, in the order the SOP evaluates them. */
export function rulesForClient(
  rules: readonly PayrollRule[],
  clientKey: string | null | undefined,
): PayrollRule[] {
  if (!clientKey) return [];
  return rules
    .filter((r) => r.clientKey === clientKey)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/* ------------------------------------------------------------------ */
/* Zone category                                                       */
/* ------------------------------------------------------------------ */

/**
 * Banding is the client's own thresholds, falling back to the SOP's 110 / 70.
 * A zone with no efficiency is `not_set`, never "low": a zone nobody measured
 * has not been judged, and treating absent as bad would punish the whole fleet
 * the first month the feature ships.
 */
export function zoneCategoryFor(
  efficiency: number | null | undefined,
  goodThreshold = 110,
  averageThreshold = 70,
): ZoneCategory {
  if (efficiency === null || efficiency === undefined || !Number.isFinite(efficiency)) {
    return "not_set";
  }
  if (efficiency >= goodThreshold) return "good";
  if (efficiency >= averageThreshold) return "average";
  return "low";
}

/* ------------------------------------------------------------------ */
/* Condition evaluation                                                */
/* ------------------------------------------------------------------ */

function compareNumeric(actual: number, op: RuleOp, expected: unknown): boolean {
  const value = asNumber(expected);
  if (value === null) return false;
  switch (op) {
    case "lt":
      return actual < value;
    case "lte":
      return actual <= value;
    case "gt":
      return actual > value;
    case "gte":
      return actual >= value;
    case "eq":
      return actual === value;
    case "neq":
      return actual !== value;
    default:
      return false;
  }
}

function compareSet(
  actual: string,
  op: RuleOp,
  expected: unknown,
): boolean {
  const list = (Array.isArray(expected) ? expected : [expected])
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean);
  const hit = list.includes(actual.trim().toLowerCase());
  return op === "not_in" ? !hit : hit;
}

export function matchesCondition(
  condition: PayrollRuleCondition,
  facts: { zoneName: string | null; zoneCategory: ZoneCategory; orders: number; hours: number },
): boolean {
  switch (condition.field) {
    case "orders":
      return compareNumeric(facts.orders, condition.op, condition.value);
    case "hours":
      return compareNumeric(facts.hours, condition.op, condition.value);
    case "zone_category":
      return compareSet(facts.zoneCategory, condition.op, condition.value);
    case "zone":
      return compareSet(facts.zoneName ?? "", condition.op, condition.value);
    default:
      return false;
  }
}

export type RuleFacts = {
  zoneName: string | null;
  zoneCategory: ZoneCategory;
  orders: number;
  hours: number;
};

/** The first rule whose every condition holds. Null when none does. */
export function firstMatchingRule(
  rules: readonly PayrollRule[],
  facts: RuleFacts,
): PayrollRule | null {
  for (const rule of rules) {
    if (rule.conditions.length === 0) continue;
    if (rule.conditions.every((c) => matchesCondition(c, facts))) return rule;
  }
  return null;
}

/** "Good or Average zone and orders less than 7" — for the settings table and
 *  the simulator, so the reader never has to decode jsonb. */
export function describeRule(rule: Pick<PayrollRule, "label" | "conditions" | "result">): string {
  const label = rule.label.trim();
  if (label) return label;
  return rule.conditions.map(describeCondition).join(" and ");
}

const OP_WORD: Record<RuleOp, string> = {
  lt: "less than",
  lte: "at most",
  gt: "more than",
  gte: "at least",
  eq: "is",
  neq: "is not",
  in: "is one of",
  not_in: "is not one of",
};

const FIELD_WORD: Record<RuleField, string> = {
  zone_category: "Zone",
  zone: "Zone",
  orders: "Orders",
  hours: "Hours",
};

const CATEGORY_WORD: Record<string, string> = {
  good: "Good",
  average: "Average",
  low: "Low",
  not_set: "Not set",
};

export function describeCondition(condition: PayrollRuleCondition): string {
  const field = FIELD_WORD[condition.field];
  const op = OP_WORD[condition.op];
  const value = Array.isArray(condition.value)
    ? condition.value
        .map((v) => (condition.field === "zone_category" ? (CATEGORY_WORD[v] ?? v) : v))
        .join(", ")
    : condition.field === "zone_category"
      ? (CATEGORY_WORD[String(condition.value)] ?? String(condition.value))
      : String(condition.value);
  return `${field} ${op} ${value}`;
}

export function describeResult(result: PayrollRuleResult): string {
  if (result.kind === "CUS") return `${result.hours ?? 0} h (custom)`;
  return RULE_RESULT_LABEL[result.kind];
}

/**
 * The hours a rule's result is worth, or null when the result is the actual
 * logged hours (ACT). The Settings table and the simulator print it beside the
 * result so an operator can see the payout without decoding `kind`.
 */
export function ruleHoursFor(result: PayrollRuleResult): number | null {
  switch (result.kind) {
    case "12":
      return PAYROLL_DAY_HOURS;
    case "3h":
      return 3;
    case "HALF":
      return 6;
    case "CUS":
      return result.hours ?? null;
    case "ACT":
    case "ABS":
    case "ALH":
    case "ALO":
      return null;
    default: {
      const _never: never = result.kind;
      return _never;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Hours                                                               */
/* ------------------------------------------------------------------ */

export function fallbackClientConfig(clientKey: string): PayrollClientConfig {
  return {
    key: clientKey,
    name: clientKey,
    usesZone: false,
    usesOrders: true,
    usesHours: false,
    fullDayHours: PAYROLL_DAY_HOURS,
    halfDayHours: 6,
    reducedHours: 3,
    requiredHoursPerDay: PAYROLL_DAY_HOURS,
    defaultOffDays: PAYROLL_DEFAULT_OFF_DAYS,
    defaultResult: { kind: "12", hours: null },
    goodThreshold: 110,
    averageThreshold: 70,
    isSystem: false,
    sortOrder: 100,
  };
}

/**
 * Hours credited for a day status. `ACT` and `custom` carry their own hours;
 * everything else is the client's value for that day type.
 */
export function hoursForStatus(
  status: DayStatus,
  ctx: { client: PayrollClientConfig | null; loggedHours: number; customHours?: number | null },
): number {
  const client = ctx.client;
  const full = client?.fullDayHours ?? PAYROLL_DAY_HOURS;
  const half = client?.halfDayHours ?? 6;
  const reduced = client?.reducedHours ?? 3;
  switch (status) {
    case "work":
      return full;
    case "reduced3":
      return reduced;
    case "half":
      return half;
    case "actual":
      return round2(Math.max(0, ctx.loggedHours));
    case "custom":
      return round2(Math.max(0, ctx.customHours ?? 0));
    case "off":
    case "sick":
    case "accident":
    case "vehicle":
    case "absent":
    case "abs_lh":
    case "abs_lo":
    case "blank":
      return 0;
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** True for the statuses the SOP treats as a worked day in the totals. */
export function isCreditedDay(status: DayStatus): boolean {
  return status === "work" || status === "reduced3" || status === "half" || status === "actual" || status === "custom";
}

/** True for the four Operations statuses (SOP section 10's list). */
export function isOpsStatus(status: DayStatus): boolean {
  return status === "off" || status === "sick" || status === "accident" || status === "vehicle";
}

/** True for the statuses a client rule can produce. */
export function isRuleStatus(status: DayStatus): boolean {
  return (
    status === "work" ||
    status === "reduced3" ||
    status === "half" ||
    status === "actual" ||
    status === "custom" ||
    status === "absent" ||
    status === "abs_lh" ||
    status === "abs_lo"
  );
}

/* ------------------------------------------------------------------ */
/* Day evaluation                                                      */
/* ------------------------------------------------------------------ */

export type DayAdjustment = { status: AdjustmentStatus; hours: number | null };

export type DayFacts = {
  date: string;
  today: string;
  client: PayrollClientConfig | null;
  rules: readonly PayrollRule[];
  zoneName: string | null;
  zoneCategory: ZoneCategory;
  /** Kuwait check-in → check-out hours for this date. */
  loggedHours: number;
  /** Daily final adjusted orders for this date. */
  orders: number;
  /** The Operations cover on this date, from an approved or pending request. */
  cover: "off" | "sick" | "accident" | null;
  coverApproved: boolean;
  hasCheckIn: boolean;
  adjustment: DayAdjustment | null;
};

export type DaySource = "future" | "adjustment" | "operations" | "rule" | "default" | "legacy";

export type DayOutcome = {
  status: DayStatus;
  /** Credited hours for this day. */
  hours: number;
  source: DaySource;
  /** The rule that decided the day, when a rule did. */
  ruleLabel: string | null;
  /** A hand adjustment is in force for this date. */
  adjusted: boolean;
  /** An Operations cover with no approval behind it. */
  unjustified: boolean;
};

/**
 * Decide one rider-day.
 *
 * The legacy branch is deliberately the old `classifyDay` verbatim — a client
 * with no configured rules must produce byte-identical numbers to the module
 * before this engine existed, because that is what stops the rule work from
 * moving a month nobody has configured yet. That includes a client whose rule
 * list for the month is empty: `rules.length > 0` is required before the client
 * branch is taken at all.
 */
export function evalDay(facts: DayFacts): DayOutcome {
  if (facts.date > facts.today) {
    return {
      status: "blank",
      hours: 0,
      source: "future",
      ruleLabel: null,
      adjusted: false,
      unjustified: false,
    };
  }

  // 1. a hand adjustment outranks everything, including Operations.
  const adj = facts.adjustment;
  if (adj && adj.status !== "auto") {
    const status = ADJUSTMENT_STATUS_TO_DAY[adj.status];
    return {
      status,
      hours: hoursForStatus(status, {
        client: facts.client,
        loggedHours: facts.loggedHours,
        customHours: adj.hours,
      }),
      source: "adjustment",
      ruleLabel: null,
      adjusted: true,
      unjustified: false,
    };
  }

  // 2. Operations, when the rider has a client with a rule list.
  //    A client with no saved rules for the month deliberately does NOT take
  //    this branch: an empty list means nobody has configured this client, and
  //    applying the client default with no guards would credit a rider who
  //    never turned up. The legacy classification is the safe answer and is
  //    what the month looked like before the engine existed.
  if (facts.client && facts.rules.length > 0) {
    if (facts.cover) {
      return {
        status: facts.cover,
        hours: 0,
        source: "operations",
        ruleLabel: null,
        adjusted: false,
        unjustified: !facts.coverApproved,
      };
    }

    const rule = firstMatchingRule(facts.rules, {
      zoneName: facts.zoneName,
      zoneCategory: facts.zoneCategory,
      orders: facts.orders,
      hours: facts.loggedHours,
    });
    if (rule) {
      const status = RULE_KIND_TO_STATUS[rule.result.kind];
      return {
        status,
        hours: hoursForStatus(status, {
          client: facts.client,
          loggedHours: facts.loggedHours,
          customHours: rule.result.hours ?? null,
        }),
        source: "rule",
        ruleLabel: describeRule(rule),
        adjusted: false,
        unjustified: false,
      };
    }

    const status = RULE_KIND_TO_STATUS[facts.client.defaultResult.kind];
    return {
      status,
      hours: hoursForStatus(status, {
        client: facts.client,
        loggedHours: facts.loggedHours,
        customHours: facts.client.defaultResult.hours ?? null,
      }),
      source: "default",
      ruleLabel: null,
      adjusted: false,
      unjustified: false,
    };
  }

  // 3. no client configured → the module's original classification.
  if (facts.hasCheckIn) {
    return {
      status: "work",
      hours: PAYROLL_DAY_HOURS,
      source: "legacy",
      ruleLabel: null,
      adjusted: false,
      unjustified: false,
    };
  }
  if (facts.cover) {
    return {
      status: facts.cover,
      hours: 0,
      source: "legacy",
      ruleLabel: null,
      adjusted: false,
      unjustified: !facts.coverApproved,
    };
  }
  return {
    status: "absent",
    hours: 0,
    source: "legacy",
    ruleLabel: null,
    adjusted: false,
    unjustified: false,
  };
}

/**
 * Would this client's rules decide the day differently from the legacy path?
 * The Settings tab uses it to warn before a client is switched on, and the
 * tests use it to prove a client with no rules changes nothing.
 */
export function wouldRulesChangeDay(facts: DayFacts): boolean {
  if (!facts.client || facts.rules.length === 0) return false;
  const withoutClient = evalDay({ ...facts, client: null, rules: [] });
  const withClient = evalDay(facts);
  return withClient.status !== withoutClient.status;
}
