import { describeRule, RULE_RESULT_LABEL, type PayrollRuleCondition, type PayrollRuleResult } from "./payroll-rules-engine";

/**
 * The Settings rule table is column-wise (zone category, zone, hours range,
 * orders range) while the engine stores a flat `all` list of conditions. These
 * two shapes have to round-trip or a save would rewrite a rule the operator
 * never touched.
 */

export type ZoneCategoryColumn = "any" | "good" | "average" | "low" | "good_or_average";

export type RuleTableRow = {
  zoneCategory: ZoneCategoryColumn;
  zone: string | "any";
  hoursMinOp: "gte" | "gt";
  hoursMin: number | null;
  hoursMaxOp: "lt" | "lte";
  hoursMax: number | null;
  ordersMin: number | null;
  ordersMax: number | null;
  result: PayrollRuleResult;
};

const EMPTY: RuleTableRow = {
  zoneCategory: "any",
  zone: "any",
  hoursMinOp: "gte",
  hoursMin: null,
  hoursMaxOp: "lt",
  hoursMax: null,
  ordersMin: null,
  ordersMax: null,
  result: { kind: "12", hours: null },
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function conditionsToColumns(
  conditions: readonly PayrollRuleCondition[],
  result: PayrollRuleResult,
): RuleTableRow {
  const row: RuleTableRow = { ...EMPTY, result: { ...result } };
  for (const condition of conditions) {
    if (condition.field === "zone_category") {
      const values = Array.isArray(condition.value)
        ? condition.value.map(String)
        : [String(condition.value)];
      const set = new Set(values.map((v) => v.toLowerCase()));
      if (condition.op === "eq" && values.length === 1) {
        const one = values[0].toLowerCase();
        if (one === "good" || one === "average" || one === "low") row.zoneCategory = one;
      } else if (condition.op === "in" && set.has("good") && set.has("average") && set.size === 2) {
        row.zoneCategory = "good_or_average";
      }
    } else if (condition.field === "zone") {
      if (condition.op === "eq") row.zone = String(condition.value);
    } else if (condition.field === "hours") {
      const n = asNumber(condition.value);
      if (n == null) continue;
      if (condition.op === "gte" || condition.op === "gt") {
        row.hoursMinOp = condition.op;
        row.hoursMin = n;
      } else if (condition.op === "lt" || condition.op === "lte") {
        row.hoursMaxOp = condition.op;
        row.hoursMax = n;
      } else if (condition.op === "eq") {
        row.hoursMinOp = "gte";
        row.hoursMaxOp = "lte";
        row.hoursMin = n;
        row.hoursMax = n;
      }
    } else if (condition.field === "orders") {
      const n = asNumber(condition.value);
      if (n == null) continue;
      if (condition.op === "gte" || condition.op === "gt") row.ordersMin = n;
      else if (condition.op === "lt" || condition.op === "lte") row.ordersMax = n;
      else if (condition.op === "eq") {
        row.ordersMin = n;
        row.ordersMax = n;
      }
    }
  }
  return row;
}

export function columnsToConditions(
  row: RuleTableRow,
  uses: { usesZone: boolean; usesOrders: boolean; usesHours: boolean },
): PayrollRuleCondition[] {
  const conditions: PayrollRuleCondition[] = [];
  if (uses.usesZone) {
    if (row.zoneCategory === "good" || row.zoneCategory === "average" || row.zoneCategory === "low") {
      conditions.push({ field: "zone_category", op: "eq", value: row.zoneCategory });
    } else if (row.zoneCategory === "good_or_average") {
      conditions.push({ field: "zone_category", op: "in", value: ["good", "average"] });
    }
    if (row.zone !== "any" && row.zone.trim()) {
      conditions.push({ field: "zone", op: "eq", value: row.zone.trim() });
    }
  }
  if (uses.usesHours) {
    if (row.hoursMin != null) {
      conditions.push({ field: "hours", op: row.hoursMinOp, value: row.hoursMin });
    }
    if (row.hoursMax != null) {
      conditions.push({ field: "hours", op: row.hoursMaxOp, value: row.hoursMax });
    }
  }
  if (uses.usesOrders) {
    if (row.ordersMin != null) {
      conditions.push({ field: "orders", op: "gte", value: row.ordersMin });
    }
    if (row.ordersMax != null) {
      conditions.push({ field: "orders", op: "lt", value: row.ordersMax });
    }
  }
  return conditions;
}

export function readsAs(
  row: RuleTableRow,
  uses: { usesZone: boolean; usesOrders: boolean; usesHours: boolean },
): string {
  const conditions = columnsToConditions(row, uses);
  return describeRule({ label: "", conditions, result: row.result });
}

export function resultReadsAs(result: PayrollRuleResult): string {
  if (result.kind === "CUS" && result.hours != null) return `${result.hours}h custom`;
  return RULE_RESULT_LABEL[result.kind];
}

export function summariseAudit(input: {
  entity: string;
  action: string;
  clientKey: string | null;
  before: unknown;
  after: unknown;
}): string {
  const who = input.clientKey ? ` · ${input.clientKey}` : "";
  if (input.entity === "zone_override") return `Zone override ${input.action}${who}`;
  if (input.entity === "zone_settings") return `Zone settings ${input.action}`;
  if (input.entity === "client") return `Client ${input.action}${who}`;
  if (input.entity === "rules") {
    const after = input.after as { length?: number } | null;
    const count = Array.isArray(input.after)
      ? input.after.length
      : typeof after?.length === "number"
        ? after.length
        : null;
    return count == null ? `Rules ${input.action}${who}` : `Rules ${input.action}${who} · ${count} rule(s)`;
  }
  return `${input.entity} ${input.action}${who}`;
}
