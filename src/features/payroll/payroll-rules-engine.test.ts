import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADJUSTMENT_STATUS_TO_DAY,
  describeCondition,
  describeResult,
  describeRule,
  evalDay,
  firstMatchingRule,
  hoursForStatus,
  isCreditedDay,
  isOpsStatus,
  isRuleStatus,
  matchesCondition,
  normaliseRuleKind,
  parseRule,
  parseRuleConditions,
  parseRuleResult,
  parseRules,
  ruleHoursFor,
  rulesForClient,
  wouldRulesChangeDay,
  zoneCategoryFor,
  type DayFacts,
  type PayrollClientConfig,
  type PayrollRule,
} from "./payroll-rules-engine";

/* ------------------------------------------------------------------ */
/* The SOP starting rules, verbatim from payroll_default_rules()       */
/* ------------------------------------------------------------------ */

const MONTH = "2026-10-01";

function rule(
  sortOrder: number,
  label: string,
  conditions: PayrollRule["conditions"],
  kind: PayrollRule["result"]["kind"],
  hours: number | null = null,
): PayrollRule {
  return {
    clientKey: "americana",
    periodMonth: MONTH,
    sortOrder,
    label,
    conditions,
    result: { kind, hours },
  };
}

function client(
  key: string,
  overrides: Partial<PayrollClientConfig> = {},
): PayrollClientConfig {
  const base: PayrollClientConfig = {
    key,
    name: key,
    usesZone: false,
    usesOrders: true,
    usesHours: false,
    fullDayHours: 12,
    halfDayHours: 6,
    reducedHours: 3,
    requiredHoursPerDay: 12,
    defaultOffDays: 2,
    defaultResult: { kind: "12", hours: null },
    goodThreshold: 110,
    averageThreshold: 70,
    isSystem: true,
    sortOrder: 10,
  };
  return { ...base, ...overrides };
}

/** SOP section 5.2 — Americana, four rules plus a full-day default. */
function americanaRules(): PayrollRule[] {
  return parseRules([
    {
      clientKey: "americana",
      periodMonth: MONTH,
      sortOrder: 10,
      label: "Orders less than 1",
      conditions: [{ field: "orders", op: "lt", value: 1 }],
      result: { kind: "ABS" },
    },
    {
      clientKey: "americana",
      periodMonth: MONTH,
      sortOrder: 20,
      label: "Zone Khiran (low-volume zone)",
      conditions: [{ field: "zone", op: "eq", value: "Khiran" }],
      result: { kind: "12" },
    },
    {
      clientKey: "americana",
      periodMonth: MONTH,
      sortOrder: 30,
      label: "Low zone and orders less than 5",
      conditions: [
        { field: "zone_category", op: "eq", value: "low" },
        { field: "orders", op: "lt", value: 5 },
      ],
      result: { kind: "3h" },
    },
    {
      clientKey: "americana",
      periodMonth: MONTH,
      sortOrder: 40,
      label: "Good or Average zone and orders less than 7",
      conditions: [
        { field: "zone_category", op: "in", value: ["good", "average"] },
        { field: "orders", op: "lt", value: 7 },
      ],
      result: { kind: "3h" },
    },
  ]);
}

/** SOP section 5.3 — Keeta, seven rules plus an Actual-hours default. */
function keetaRules(): PayrollRule[] {
  return parseRules([
    {
      clientKey: "keeta",
      periodMonth: MONTH,
      sortOrder: 10,
      label: "No worked hours and no orders",
      conditions: [
        { field: "hours", op: "lt", value: 0.5 },
        { field: "orders", op: "lt", value: 1 },
      ],
      result: { kind: "ABS" },
    },
    {
      clientKey: "keeta",
      periodMonth: MONTH,
      sortOrder: 20,
      label: "Orders less than 3",
      conditions: [{ field: "orders", op: "lt", value: 3 }],
      result: { kind: "ALO" },
    },
    {
      clientKey: "keeta",
      periodMonth: MONTH,
      sortOrder: 30,
      label: "Worked hours less than 4",
      conditions: [{ field: "hours", op: "lt", value: 4 }],
      result: { kind: "ALH" },
    },
    {
      clientKey: "keeta",
      periodMonth: MONTH,
      sortOrder: 40,
      label: "Under 6 hours and 6 orders or more",
      conditions: [
        { field: "hours", op: "lt", value: 6 },
        { field: "orders", op: "gte", value: 6 },
      ],
      result: { kind: "HALF" },
    },
    {
      clientKey: "keeta",
      periodMonth: MONTH,
      sortOrder: 50,
      label: "10 to 12 hours and 6 orders or more",
      conditions: [
        { field: "hours", op: "gte", value: 10 },
        { field: "hours", op: "lte", value: 12 },
        { field: "orders", op: "gte", value: 6 },
      ],
      result: { kind: "ACT" },
    },
    {
      clientKey: "keeta",
      periodMonth: MONTH,
      sortOrder: 60,
      label: "10 to 12 hours and orders under 6",
      conditions: [
        { field: "hours", op: "gte", value: 10 },
        { field: "hours", op: "lte", value: 12 },
        { field: "orders", op: "lt", value: 6 },
      ],
      result: { kind: "HALF" },
    },
    {
      clientKey: "keeta",
      periodMonth: MONTH,
      sortOrder: 70,
      label: "More than 12 hours",
      conditions: [{ field: "hours", op: "gt", value: 12 }],
      result: { kind: "12" },
    },
  ]);
}

const AMERICANA = client("americana", { usesZone: true, usesOrders: true });
const KEETA = client("keeta", {
  usesZone: false,
  usesOrders: true,
  usesHours: true,
  defaultResult: { kind: "ACT", hours: null },
});

function facts(overrides: Partial<DayFacts> = {}): DayFacts {
  return {
    date: "2026-10-05",
    today: "2026-10-31",
    client: AMERICANA,
    rules: americanaRules(),
    zoneName: "Salmiya",
    zoneCategory: "good",
    loggedHours: 12,
    orders: 10,
    cover: null,
    coverApproved: false,
    hasCheckIn: true,
    adjustment: null,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */

describe("rule parsing", () => {
  it("normalises the SOP result codes", () => {
    assert.equal(normaliseRuleKind("12"), "12");
    assert.equal(normaliseRuleKind("3H"), "3h");
    assert.equal(normaliseRuleKind("half"), "HALF");
    assert.equal(normaliseRuleKind("act"), "ACT");
    assert.equal(normaliseRuleKind("abs"), "ABS");
    assert.equal(normaliseRuleKind("alh"), "ALH");
    assert.equal(normaliseRuleKind("alo"), "ALO");
    assert.equal(normaliseRuleKind("cus"), "CUS");
    assert.equal(normaliseRuleKind("nope"), null);
  });

  it("keeps hours only for CUS", () => {
    assert.deepEqual(parseRuleResult({ kind: "CUS", hours: 7.5 }), {
      kind: "CUS",
      hours: 7.5,
    });
    assert.deepEqual(parseRuleResult({ kind: "HALF", hours: 9 }), {
      kind: "HALF",
      hours: null,
    });
    assert.deepEqual(parseRuleResult(null), { kind: "12", hours: null });
  });

  it("drops a condition it cannot evaluate instead of matching everything", () => {
    const conditions = parseRuleConditions([
      { field: "orders", op: "lt", value: 5 },
      { field: "nope", op: "lt", value: 5 },
      { field: "orders", op: "wat", value: 5 },
      { field: "orders", op: "lt", value: "abc" },
    ]);
    assert.equal(conditions.length, 1);
    assert.deepEqual(conditions[0], { field: "orders", op: "lt", value: 5 });
  });

  it("lowercases set values so a zone category compares case-insensitively", () => {
    const conditions = parseRuleConditions([
      { field: "zone_category", op: "in", value: ["Good", "AVERAGE"] },
    ]);
    assert.deepEqual(conditions[0].value, ["good", "average"]);
  });

  it("sorts by client then sort order", () => {
    const rules = parseRules([
      { clientKey: "keeta", periodMonth: MONTH, sortOrder: 20, conditions: [], result: { kind: "12" } },
      { clientKey: "americana", periodMonth: MONTH, sortOrder: 40, conditions: [], result: { kind: "12" } },
      { clientKey: "americana", periodMonth: MONTH, sortOrder: 10, conditions: [], result: { kind: "12" } },
    ]);
    assert.deepEqual(
      rules.map((r) => `${r.clientKey}:${r.sortOrder}`),
      ["americana:10", "americana:40", "keeta:20"],
    );
    assert.equal(rulesForClient(rules, "americana").length, 2);
    assert.equal(rulesForClient(rules, null).length, 0);
  });
});

describe("zone category banding", () => {
  it("bands at the SOP thresholds and never judges an unmeasured zone", () => {
    assert.equal(zoneCategoryFor(120), "good");
    assert.equal(zoneCategoryFor(110), "good");
    assert.equal(zoneCategoryFor(109.9), "average");
    assert.equal(zoneCategoryFor(70), "average");
    assert.equal(zoneCategoryFor(69.9), "low");
    assert.equal(zoneCategoryFor(null), "not_set");
    assert.equal(zoneCategoryFor(Number.NaN), "not_set");
  });

  it("honours a client's own thresholds", () => {
    assert.equal(zoneCategoryFor(100, 100, 60), "good");
    assert.equal(zoneCategoryFor(80, 100, 60), "average");
  });
});

describe("condition matching", () => {
  const base = { zoneName: "Khiran", zoneCategory: "low" as const, orders: 4, hours: 9 };

  it("compares numbers with every operator", () => {
    assert.equal(matchesCondition({ field: "orders", op: "lt", value: 5 }, base), true);
    assert.equal(matchesCondition({ field: "orders", op: "lte", value: 4 }, base), true);
    assert.equal(matchesCondition({ field: "orders", op: "gt", value: 4 }, base), false);
    assert.equal(matchesCondition({ field: "orders", op: "gte", value: 4 }, base), true);
    assert.equal(matchesCondition({ field: "orders", op: "eq", value: 4 }, base), true);
    assert.equal(matchesCondition({ field: "orders", op: "neq", value: 4 }, base), false);
  });

  it("compares zone and category as sets, case-insensitively", () => {
    assert.equal(matchesCondition({ field: "zone", op: "eq", value: "khiran" }, base), true);
    assert.equal(matchesCondition({ field: "zone", op: "eq", value: "salmiya" }, base), false);
    assert.equal(
      matchesCondition({ field: "zone_category", op: "in", value: ["low", "average"] }, base),
      true,
    );
    assert.equal(
      matchesCondition({ field: "zone_category", op: "not_in", value: ["low"] }, base),
      false,
    );
  });

  it("ignores a rule with no conditions rather than matching every day", () => {
    const rules = [rule(10, "", [], "ABS")];
    assert.equal(
      firstMatchingRule(rules, { zoneName: null, zoneCategory: "not_set", orders: 5, hours: 5 }),
      null,
    );
  });
});

describe("SOP 5.2 — Americana rules decide the documented day", () => {
  const rules = americanaRules();
  const decide = (zoneCategory: DayFacts["zoneCategory"], orders: number, zone = "Salmiya") =>
    evalDay(facts({ rules, zoneCategory, orders, zoneName: zone }));

  it("rule 1: no orders is Absent", () => {
    const outcome = decide("good", 0);
    assert.equal(outcome.status, "absent");
    assert.equal(outcome.hours, 0);
    assert.equal(outcome.source, "rule");
    assert.equal(outcome.ruleLabel, "Orders less than 1");
  });

  it("rule 2: Khiran is a full day in any zone category", () => {
    for (const category of ["low", "average", "good", "not_set"] as const) {
      for (const orders of [0, 2, 9]) {
        const outcome = decide(category, orders, "Khiran");
        // Orders < 1 is still evaluated first, so 0 orders stays Absent.
        if (orders === 0) {
          assert.equal(outcome.status, "absent");
          continue;
        }
        assert.equal(outcome.status, "work");
        assert.equal(outcome.hours, 12);
      }
    }
  });

  it("rule 3: a Low zone under 5 orders is a 3 h day", () => {
    const outcome = decide("low", 4);
    assert.equal(outcome.status, "reduced3");
    assert.equal(outcome.hours, 3);
    assert.equal(outcome.ruleLabel, "Low zone and orders less than 5");
  });

  it("rule 3 does not fire at exactly 5 orders", () => {
    const outcome = decide("low", 5);
    assert.equal(outcome.status, "work");
    assert.equal(outcome.source, "default");
  });

  it("rule 4: Good or Average under 7 orders is a 3 h day", () => {
    for (const category of ["good", "average"] as const) {
      const outcome = decide(category, 6);
      assert.equal(outcome.status, "reduced3");
      assert.equal(outcome.ruleLabel, "Good or Average zone and orders less than 7");
    }
  });

  it("rule 4 does not fire at exactly 7 orders, so the default 12 applies", () => {
    for (const category of ["good", "average"] as const) {
      const outcome = decide(category, 7);
      assert.equal(outcome.status, "work");
      assert.equal(outcome.hours, 12);
      assert.equal(outcome.source, "default");
    }
  });

  it("a Not set zone only ever reaches the rules that do not read the category", () => {
    // Khiran matches, orders < 1 matches, everything category-based does not.
    assert.equal(decide("not_set", 3).source, "default");
    assert.equal(decide("not_set", 3).status, "work");
    assert.equal(decide("not_set", 0).status, "absent");
    assert.equal(decide("not_set", 3, "Khiran").status, "work");
  });
});

describe("SOP 5.3 — Keeta rules decide the documented day", () => {
  const rules = keetaRules();
  const decide = (orders: number, hours: number) =>
    evalDay(
      facts({
        client: KEETA,
        rules,
        zoneName: "Salmiya",
        zoneCategory: "not_set",
        orders,
        loggedHours: hours,
      }),
    );

  it("no hours and no orders is Absent", () => {
    const outcome = decide(0, 0);
    assert.equal(outcome.status, "absent");
    assert.equal(outcome.source, "rule");
  });

  it("under 3 orders is Abs·LO", () => {
    assert.equal(decide(2, 9).status, "abs_lo");
    assert.equal(decide(2, 13).status, "abs_lo");
  });

  it("under 4 hours is Abs·LH", () => {
    assert.equal(decide(8, 3.5).status, "abs_lh");
    assert.equal(decide(3, 3.5).status, "abs_lh");
    // 0 orders meets "Orders less than 3" before the hours rule, so it is
    // Abs·LO even though the hours are under 4 — the SOP evaluates top-down.
    assert.equal(decide(0, 2).status, "abs_lo");
  });

  it("under 6 hours with 6+ orders is a Half day", () => {
    const outcome = decide(7, 5);
    assert.equal(outcome.status, "half");
    assert.equal(outcome.hours, 6);
  });

  it("10 to 12 hours with 6+ orders pays the actual hours", () => {
    const outcome = decide(8, 11);
    assert.equal(outcome.status, "actual");
    assert.equal(outcome.hours, 11);
    assert.equal(outcome.ruleLabel, "10 to 12 hours and 6 orders or more");
  });

  it("10 to 12 hours under 6 orders is a Half day", () => {
    assert.equal(decide(4, 11).status, "half");
    assert.equal(decide(4, 11).hours, 6);
  });

  it("more than 12 hours is a full day", () => {
    const outcome = decide(10, 13.5);
    assert.equal(outcome.status, "work");
    assert.equal(outcome.hours, 12);
    assert.equal(outcome.ruleLabel, "More than 12 hours");
  });

  it("falls through to the Keeta default (Actual hours) in the 6–10 h band", () => {
    const outcome = decide(6, 8);
    assert.equal(outcome.source, "default");
    assert.equal(outcome.status, "actual");
    assert.equal(outcome.hours, 8);
  });
});

describe("SOP 7 — the ten worked examples", () => {
  const cases: Array<{
    name: string;
    client: PayrollClientConfig;
    rules: PayrollRule[];
    zoneCategory: DayFacts["zoneCategory"];
    zoneName?: string;
    orders: number;
    hours: number;
    status: DayFacts extends never ? never : string;
    credited: number;
  }> = [
    { name: "Good zone, 6 orders", client: AMERICANA, rules: americanaRules(), zoneCategory: "good", orders: 6, hours: 12, status: "reduced3", credited: 3 },
    { name: "Good zone, 7 orders", client: AMERICANA, rules: americanaRules(), zoneCategory: "good", orders: 7, hours: 12, status: "work", credited: 12 },
    { name: "Low zone, 4 orders", client: AMERICANA, rules: americanaRules(), zoneCategory: "low", orders: 4, hours: 12, status: "reduced3", credited: 3 },
    { name: "Khiran, 2 orders", client: AMERICANA, rules: americanaRules(), zoneCategory: "low", zoneName: "Khiran", orders: 2, hours: 12, status: "work", credited: 12 },
    { name: "Keeta 2 orders / 9 h", client: KEETA, rules: keetaRules(), zoneCategory: "not_set", orders: 2, hours: 9, status: "abs_lo", credited: 0 },
    { name: "Keeta 8 orders / 3.5 h", client: KEETA, rules: keetaRules(), zoneCategory: "not_set", orders: 8, hours: 3.5, status: "abs_lh", credited: 0 },
    { name: "Keeta 7 orders / 5 h", client: KEETA, rules: keetaRules(), zoneCategory: "not_set", orders: 7, hours: 5, status: "half", credited: 6 },
    { name: "Keeta 8 orders / 11 h", client: KEETA, rules: keetaRules(), zoneCategory: "not_set", orders: 8, hours: 11, status: "actual", credited: 11 },
    { name: "Keeta 4 orders / 11 h", client: KEETA, rules: keetaRules(), zoneCategory: "not_set", orders: 4, hours: 11, status: "half", credited: 6 },
    { name: "Keeta 10 orders / 13.5 h", client: KEETA, rules: keetaRules(), zoneCategory: "not_set", orders: 10, hours: 13.5, status: "work", credited: 12 },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} → ${testCase.status}`, () => {
      const outcome = evalDay(
        facts({
          client: testCase.client,
          rules: testCase.rules,
          zoneCategory: testCase.zoneCategory,
          zoneName: testCase.zoneName ?? "Salmiya",
          orders: testCase.orders,
          loggedHours: testCase.hours,
        }),
      );
      assert.equal(outcome.status, testCase.status);
      assert.equal(outcome.hours, testCase.credited);
    });
  }
});

describe("precedence: adjustment > Operations > rule > default > legacy", () => {
  const rules = americanaRules();

  it("a hand adjustment outranks an Operations cover", () => {
    const outcome = evalDay(
      facts({
        rules,
        zoneCategory: "low",
        orders: 4,
        cover: "off",
        coverApproved: true,
        adjustment: { status: "12", hours: null },
      }),
    );
    assert.equal(outcome.status, "work");
    assert.equal(outcome.source, "adjustment");
    assert.equal(outcome.adjusted, true);
    assert.equal(outcome.hours, 12);
  });

  it("an adjustment of Auto is not an adjustment", () => {
    const outcome = evalDay(facts({ rules, zoneCategory: "low", orders: 4, adjustment: { status: "auto", hours: null } }));
    assert.equal(outcome.source, "rule");
    assert.equal(outcome.adjusted, false);
  });

  it("Operations outranks a client rule", () => {
    const outcome = evalDay(
      facts({ rules, zoneCategory: "good", orders: 6, cover: "sick", coverApproved: true }),
    );
    assert.equal(outcome.status, "sick");
    assert.equal(outcome.source, "operations");
    assert.equal(outcome.hours, 0);
    assert.equal(outcome.unjustified, false);
  });

  it("an unapproved Operations cover is flagged unjustified", () => {
    const outcome = evalDay(facts({ rules, cover: "off", coverApproved: false }));
    assert.equal(outcome.status, "off");
    assert.equal(outcome.unjustified, true);
  });

  it("a rule outranks the client default", () => {
    const outcome = evalDay(facts({ rules, zoneCategory: "good", orders: 6 }));
    assert.equal(outcome.source, "rule");
  });

  it("the client default fills in when no rule matches", () => {
    const outcome = evalDay(facts({ rules, zoneCategory: "good", orders: 7 }));
    assert.equal(outcome.source, "default");
    assert.equal(outcome.status, "work");
  });

  it("a custom-hours rule credits exactly those hours", () => {
    const custom = [rule(10, "Custom", [{ field: "orders", op: "gte", value: 1 }], "CUS", 7.25)];
    const outcome = evalDay(facts({ rules: custom, zoneCategory: "good", orders: 5 }));
    assert.equal(outcome.status, "custom");
    assert.equal(outcome.hours, 7.25);
  });

  it("an Actual-hours adjustment credits the logged hours", () => {
    const outcome = evalDay(
      facts({
        rules,
        loggedHours: 8.25,
        adjustment: { status: "actual", hours: null },
      }),
    );
    assert.equal(outcome.status, "actual");
    assert.equal(outcome.hours, 8.25);
  });

  it("a custom-hours adjustment credits the entered hours", () => {
    const outcome = evalDay(
      facts({ rules, loggedHours: 8.25, adjustment: { status: "custom", hours: 5.5 } }),
    );
    assert.equal(outcome.status, "custom");
    assert.equal(outcome.hours, 5.5);
  });
});

describe("future days and the legacy fallback", () => {
  it("a day after Kuwait today is blank and worth nothing", () => {
    const outcome = evalDay(
      facts({ date: "2026-10-20", today: "2026-10-05", rules: americanaRules() }),
    );
    assert.equal(outcome.status, "blank");
    assert.equal(outcome.hours, 0);
    assert.equal(outcome.source, "future");
  });

  it("a client with no rules reproduces the pre-v4 classification exactly", () => {
    const withCheckIn = evalDay(facts({ client: null, rules: [], hasCheckIn: true }));
    assert.equal(withCheckIn.status, "work");
    assert.equal(withCheckIn.hours, 12);
    assert.equal(withCheckIn.source, "legacy");

    const cover = evalDay(
      facts({ client: null, rules: [], hasCheckIn: false, cover: "off", coverApproved: true }),
    );
    assert.equal(cover.status, "off");
    assert.equal(cover.unjustified, false);

    const absent = evalDay(facts({ client: null, rules: [], hasCheckIn: false }));
    assert.equal(absent.status, "absent");
    assert.equal(absent.hours, 0);
  });

  it("a client whose rules were never saved also uses the legacy path", () => {
    // No rules for the month → rulesForClient returned [], so evalDay must not
    // invent a default day for a rider nobody has configured.
    const outcome = evalDay(facts({ client: AMERICANA, rules: [], hasCheckIn: false }));
    assert.equal(outcome.status, "absent");
    assert.equal(outcome.source, "legacy");
  });

  it("wouldRulesChangeDay is false without a client or a rule list", () => {
    assert.equal(wouldRulesChangeDay(facts({ client: null, rules: [] })), false);
    assert.equal(wouldRulesChangeDay(facts({ client: AMERICANA, rules: [] })), false);
    assert.equal(
      wouldRulesChangeDay(facts({ rules: americanaRules(), zoneCategory: "low", orders: 4 })),
      true,
    );
  });
});

describe("hours per status", () => {
  it("uses the client's hour values and never charges for a covered day", () => {
    const custom = client("americana", { fullDayHours: 12, halfDayHours: 6, reducedHours: 3 });
    assert.equal(hoursForStatus("work", { client: custom, loggedHours: 0 }), 12);
    assert.equal(hoursForStatus("reduced3", { client: custom, loggedHours: 0 }), 3);
    assert.equal(hoursForStatus("half", { client: custom, loggedHours: 0 }), 6);
    assert.equal(hoursForStatus("actual", { client: custom, loggedHours: 9.5 }), 9.5);
    assert.equal(hoursForStatus("custom", { client: custom, loggedHours: 9, customHours: 4 }), 4);
    for (const status of ["off", "sick", "accident", "vehicle", "absent", "abs_lh", "abs_lo", "blank"] as const) {
      assert.equal(hoursForStatus(status, { client: custom, loggedHours: 9 }), 0);
    }
  });

  it("falls back to the module's 12 / 6 / 3 with no client", () => {
    assert.equal(hoursForStatus("work", { client: null, loggedHours: 0 }), 12);
    assert.equal(hoursForStatus("half", { client: null, loggedHours: 0 }), 6);
    assert.equal(hoursForStatus("reduced3", { client: null, loggedHours: 0 }), 3);
  });

  it("classifies statuses for the grid legend and the totals", () => {
    assert.equal(isCreditedDay("work"), true);
    assert.equal(isCreditedDay("actual"), true);
    assert.equal(isCreditedDay("absent"), false);
    assert.equal(isOpsStatus("off"), true);
    assert.equal(isOpsStatus("vehicle"), true);
    assert.equal(isOpsStatus("work"), false);
    assert.equal(isRuleStatus("abs_lo"), true);
    assert.equal(isRuleStatus("off"), false);
  });
});

describe("describe helpers feed the Settings table and the simulator", () => {
  it("describes a condition in words", () => {
    assert.equal(
      describeCondition({ field: "zone_category", op: "in", value: ["good", "average"] }),
      "Zone is one of Good, Average",
    );
    assert.equal(
      describeCondition({ field: "orders", op: "lt", value: 7 }),
      "Orders less than 7",
    );
    assert.equal(
      describeCondition({ field: "hours", op: "gte", value: 10 }),
      "Hours at least 10",
    );
  });

  it("describes a result and prefers the saved label", () => {
    assert.equal(describeResult({ kind: "3h" }), "Reduced day · 3 h");
    assert.equal(describeResult({ kind: "CUS", hours: 7.5 }), "7.5 h (custom)");
    assert.equal(
      describeRule({ label: "Khiran", conditions: [], result: { kind: "12" } }),
      "Khiran",
    );
    assert.equal(
      describeRule({
        label: "  ",
        conditions: [{ field: "orders", op: "lt", value: 1 }],
        result: { kind: "ABS" },
      }),
      "Orders less than 1",
    );
  });
});

describe("adjustment statuses map onto the grid's day types", () => {
  it("covers every status except Auto", () => {
    const mapped = Object.entries(ADJUSTMENT_STATUS_TO_DAY);
    assert.equal(mapped.length, 12);
    assert.equal(ADJUSTMENT_STATUS_TO_DAY["12"], "work");
    assert.equal(ADJUSTMENT_STATUS_TO_DAY["3h"], "reduced3");
    assert.equal(ADJUSTMENT_STATUS_TO_DAY.half, "half");
    assert.equal(ADJUSTMENT_STATUS_TO_DAY.actual, "actual");
    assert.equal(ADJUSTMENT_STATUS_TO_DAY.abs_lh, "abs_lh");
    assert.equal(ADJUSTMENT_STATUS_TO_DAY.abs_lo, "abs_lo");
    assert.equal(ADJUSTMENT_STATUS_TO_DAY.vehicle, "vehicle");
    assert.equal(ADJUSTMENT_STATUS_TO_DAY.custom, "custom");
  });

  it("exposes the SOP hour band a rule would need for a given day", () => {
    assert.equal(ruleHoursFor({ kind: "12" }), 12);
    assert.equal(ruleHoursFor({ kind: "3h" }), 3);
    assert.equal(ruleHoursFor({ kind: "HALF" }), 6);
    assert.equal(ruleHoursFor({ kind: "CUS", hours: 7.5 }), 7.5);
    assert.equal(ruleHoursFor({ kind: "ACT" }), null);
    assert.equal(ruleHoursFor({ kind: "ABS" }), null);
    assert.equal(ruleHoursFor({ kind: "ALH" }), null);
    assert.equal(ruleHoursFor({ kind: "ALO" }), null);
  });
});

describe("parseRule survives whatever jsonb shape it is handed", () => {
  it("reads snake_case keys from the database payload", () => {
    const parsed = parseRule({
      client_key: "keeta",
      period_month: "2026-10-01T00:00:00",
      sort_order: 20,
      label: "Orders less than 3",
      conditions: [{ field: "orders", op: "lt", value: 3 }],
      result: { kind: "ALO" },
    });
    assert.ok(parsed);
    assert.equal(parsed.clientKey, "keeta");
    assert.equal(parsed.periodMonth, "2026-10-01");
    assert.equal(parsed.sortOrder, 20);
    assert.equal(parsed.result.kind, "ALO");
  });

  it("rejects a rule with no client key", () => {
    assert.equal(parseRule({ sort_order: 10 }), null);
    assert.equal(parseRule(null), null);
  });

  it("accepts an `all` array in place of `conditions`", () => {
    const parsed = parseRule({
      clientKey: "americana",
      periodMonth: MONTH,
      sortOrder: 10,
      all: [{ field: "orders", op: "lt", value: 5 }],
      result: { kind: "3h" },
    });
    assert.ok(parsed);
    assert.equal(parsed.conditions.length, 1);
  });
});
