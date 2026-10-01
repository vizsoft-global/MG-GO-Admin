import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  columnsToConditions,
  conditionsToColumns,
  readsAs,
  summariseAudit,
  type RuleTableRow,
} from "./payroll-rule-table-model";
import type { PayrollRuleCondition } from "./payroll-rules-engine";

const USES_ALL = { usesZone: true, usesOrders: true, usesHours: true };
const USES_HOURS = { usesZone: false, usesOrders: false, usesHours: true };

function roundTrip(row: RuleTableRow, uses = USES_ALL): RuleTableRow {
  return conditionsToColumns(columnsToConditions(row, uses), row.result);
}

describe("rule table columns round-trip", () => {
  it("stores hours as gte/lt bounds and zone category in/eq", () => {
    const row: RuleTableRow = {
      zoneCategory: "good_or_average",
      zone: "Salmiya",
      hoursMinOp: "gte",
      hoursMin: 6,
      hoursMaxOp: "lt",
      hoursMax: 12,
      ordersMin: 10,
      ordersMax: 20,
      result: { kind: "12", hours: null },
    };
    const conditions = columnsToConditions(row, USES_ALL);
    assert.deepEqual(
      conditions.map((c) => [c.field, c.op, c.value]),
      [
        ["zone_category", "in", ["good", "average"]],
        ["zone", "eq", "Salmiya"],
        ["hours", "gte", 6],
        ["hours", "lt", 12],
        ["orders", "gte", 10],
        ["orders", "lt", 20],
      ],
    );
    const back = roundTrip(row);
    assert.equal(back.zoneCategory, "good_or_average");
    assert.equal(back.zone, "Salmiya");
    assert.equal(back.hoursMin, 6);
    assert.equal(back.hoursMax, 12);
    assert.equal(back.ordersMin, 10);
    assert.equal(back.ordersMax, 20);
  });

  it("maps a single hours eq onto a closed range", () => {
    const conditions: PayrollRuleCondition[] = [{ field: "hours", op: "eq", value: 8 }];
    const cols = conditionsToColumns(conditions, { kind: "CUS", hours: 8 });
    assert.equal(cols.hoursMin, 8);
    assert.equal(cols.hoursMax, 8);
    assert.equal(cols.hoursMinOp, "gte");
    assert.equal(cols.hoursMaxOp, "lte");
  });

  it("drops unused criterion columns so a Hours-only client does not save zone terms", () => {
    const row: RuleTableRow = {
      zoneCategory: "low",
      zone: "Jahra",
      hoursMinOp: "gt",
      hoursMin: 0,
      hoursMaxOp: "lte",
      hoursMax: 3,
      ordersMin: 1,
      ordersMax: 99,
      result: { kind: "3h", hours: null },
    };
    const conditions = columnsToConditions(row, USES_HOURS);
    assert.equal(conditions.every((c) => c.field === "hours"), true);
    assert.equal(conditions.length, 2);
    const back = conditionsToColumns(conditions, row.result);
    assert.equal(back.zoneCategory, "any");
    assert.equal(back.zone, "any");
    assert.equal(back.hoursMin, 0);
    assert.equal(back.hoursMax, 3);
  });

  it("reads as the engine's describeRule string", () => {
    const row: RuleTableRow = {
      zoneCategory: "good",
      zone: "any",
      hoursMinOp: "gte",
      hoursMin: 12,
      hoursMaxOp: "lt",
      hoursMax: null,
      ordersMin: null,
      ordersMax: null,
      result: { kind: "12", hours: null },
    };
    const text = readsAs(row, { usesZone: true, usesOrders: false, usesHours: true });
    assert.match(text, /12/);
    assert.match(text, /good/i);
  });
});

describe("summariseAudit", () => {
  it("names the entity, action, client, and rule count", () => {
    assert.equal(
      summariseAudit({
        entity: "rules",
        action: "save",
        clientKey: "americana",
        before: [],
        after: [{}, {}],
      }),
      "Rules save · americana · 2 rule(s)",
    );
    assert.equal(
      summariseAudit({
        entity: "zone_override",
        action: "update",
        clientKey: null,
        before: null,
        after: null,
      }),
      "Zone override update",
    );
    assert.equal(
      summariseAudit({
        entity: "client",
        action: "delete",
        clientKey: "keeta",
        before: {},
        after: null,
      }),
      "Client delete · keeta",
    );
  });
});
