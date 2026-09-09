import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsvText } from "@/lib/import/spreadsheet";
import {
  applyableIncentiveImportRows,
  clampIncentiveImportStart,
  datesOverlap,
  effectiveIncentiveImportStart,
  guessIncentiveImportColumns,
  mapIncentiveImportSheet,
  parseIncentiveTiers,
  parseIsoDate,
  previewIncentiveRuleRows,
} from "./incentive-rule-import";

test("parseIsoDate accepts real calendar days only", () => {
  assert.equal(parseIsoDate("2026-09-01"), "2026-09-01");
  assert.equal(parseIsoDate("2026-02-30"), null);
  assert.equal(parseIsoDate("01/09/2026"), "2026-09-01");
  assert.equal(parseIsoDate("not-a-date"), null);
});

test("datesOverlap is inclusive on both ends", () => {
  assert.equal(datesOverlap("2026-09-01", "2026-09-10", "2026-09-10", "2026-09-20"), true);
  assert.equal(datesOverlap("2026-09-01", "2026-09-10", "2026-09-11", "2026-09-20"), false);
});

test("parseIncentiveTiers accepts = and :fixed/:per_delivery", () => {
  assert.deepEqual(parseIncentiveTiers("50=5;80=10"), [
    { threshold_deliveries: 50, reward_mode: "fixed", amount: 5 },
    { threshold_deliveries: 80, reward_mode: "fixed", amount: 10 },
  ]);
  assert.deepEqual(parseIncentiveTiers("50:per_delivery:0.2"), [
    { threshold_deliveries: 50, reward_mode: "per_delivery", amount: 0.2 },
  ]);
  assert.equal(parseIncentiveTiers(""), null);
  assert.equal(parseIncentiveTiers("50=x"), null);
  assert.equal(parseIncentiveTiers("0=5"), null);
});

const restaurants = [{ id: "r1", name: "Talabat HQ" }];
const existing = [
  {
    id: "rule-1",
    name: "September HQ",
    status: "active",
    restaurant_ids: ["r1"],
    start_date: "2026-09-01",
    end_date: "2026-09-30",
  },
];

test("preview rejects unknown restaurant and bad dates before overlap", () => {
  const rows = previewIncentiveRuleRows({
    restaurants,
    existing,
    rows: [
      { restaurant: "Missing", start: "2026-09-01", end: "2026-09-30", tiers: "50=5" },
      { restaurant: "Talabat HQ", start: "bad", end: "2026-09-30", tiers: "50=5" },
      { restaurant: "Talabat HQ", start: "2026-09-30", end: "2026-09-01", tiers: "50=5" },
      { restaurant: "Talabat HQ", start: "2026-10-01", end: "2026-10-31", tiers: "" },
    ],
  });
  assert.equal(rows[0].status, "unknown_restaurant");
  assert.equal(rows[1].status, "invalid_start");
  assert.equal(rows[2].status, "invalid_range");
  assert.equal(rows[3].status, "invalid_tiers");
});

test("same-file overlap marks both rows; existing overlap is would_replace", () => {
  const rows = previewIncentiveRuleRows({
    restaurants,
    existing,
    rows: [
      { restaurant: "Talabat HQ", start: "2026-09-01", end: "2026-09-15", tiers: "50=5" },
      { restaurant: "Talabat HQ", start: "2026-09-10", end: "2026-09-20", tiers: "80=10" },
      { restaurant: "Talabat HQ", start: "2026-10-01", end: "2026-10-31", tiers: "50=5" },
    ],
  });
  assert.equal(rows[0].status, "file_overlap");
  assert.equal(rows[1].status, "file_overlap");
  assert.equal(rows[2].status, "ok");
  assert.equal(rows[2].restaurant_id, "r1");
});

test("overlapping an active rule is would_replace and names the rule", () => {
  const rows = previewIncentiveRuleRows({
    restaurants,
    existing,
    rows: [
      { restaurant: "Talabat HQ", start: "2026-09-15", end: "2026-10-15", tiers: "50=5" },
    ],
  });
  assert.equal(rows[0].status, "would_replace");
  assert.equal(rows[0].replace_rule_name, "September HQ");
  assert.deepEqual(rows[0].replace_rule_ids, ["rule-1"]);
});

test("ended or draft overlap is not a replace", () => {
  const rows = previewIncentiveRuleRows({
    restaurants,
    existing: [
      { ...existing[0], status: "ended" },
      {
        id: "rule-draft",
        name: "Draft HQ",
        status: "draft",
        restaurant_ids: ["r1"],
        start_date: "2026-09-01",
        end_date: "2026-09-30",
      },
    ],
    rows: [
      { restaurant: "Talabat HQ", start: "2026-09-15", end: "2026-10-15", tiers: "50=5" },
    ],
  });
  assert.equal(rows[0].status, "ok");
  assert.deepEqual(rows[0].replace_rule_ids, []);
});

test("replace names every overlapping active rule", () => {
  const rows = previewIncentiveRuleRows({
    restaurants,
    existing: [
      existing[0],
      {
        id: "rule-2",
        name: "Late September HQ",
        status: "active",
        restaurant_ids: ["r1"],
        start_date: "2026-09-20",
        end_date: "2026-10-10",
      },
    ],
    rows: [
      { restaurant: "Talabat HQ", start: "2026-09-15", end: "2026-10-15", tiers: "50=5" },
    ],
  });
  assert.equal(rows[0].status, "would_replace");
  assert.deepEqual(rows[0].replace_rule_ids, ["rule-1", "rule-2"]);
  assert.equal(rows[0].replace_rule_name, "September HQ, Late September HQ");
});

test("csv text keeps ISO dates and 50=5 tiers", () => {
  const parsed = parseCsvText(
    "Restaurant,Start,End,Tiers\nEgypt Test,2026-01-01,2026-12-31,\"50=5;80=10\"\n",
  );
  const mapped = mapIncentiveImportSheet(parsed.headers, parsed.rows);
  assert.equal(mapped[0]?.start, "2026-01-01");
  assert.equal(mapped[0]?.tiers, "50=5;80=10");
});

test("export headers do not map Name onto Restaurant", () => {
  const cols = guessIncentiveImportColumns([
    "Name",
    "Restaurant",
    "Start",
    "End",
    "Status",
    "Tiers",
    "Reward",
  ]);
  assert.deepEqual(cols, { restaurant: 1, start: 2, end: 3, tiers: 5 });
  const mapped = mapIncentiveImportSheet(
    ["Name", "Restaurant", "Start", "End", "Tiers"],
    [["Old name", "Talabat HQ", "2026-09-01", "2026-09-30", "50=5"]],
  );
  assert.equal(mapped[0]?.restaurant, "Talabat HQ");
});

test("clamp is a no-op when uploaded start is today or later", () => {
  assert.equal(clampIncentiveImportStart("2026-09-09", "2026-09-09"), "2026-09-09");
  assert.equal(clampIncentiveImportStart("2026-09-10", "2026-09-09"), "2026-09-10");
});

test("clamp pulls a past uploaded start up to Kuwait today", () => {
  assert.equal(clampIncentiveImportStart("2026-01-01", "2026-09-09"), "2026-09-09");
});

test("effective start clamps only when the row replaces an active rule", () => {
  assert.equal(
    effectiveIncentiveImportStart({
      uploadedStart: "2026-01-01",
      kuwaitToday: "2026-09-09",
      replaces: false,
    }),
    "2026-01-01",
  );
  assert.equal(
    effectiveIncentiveImportStart({
      uploadedStart: "2026-01-01",
      kuwaitToday: "2026-09-09",
      replaces: true,
    }),
    "2026-09-09",
  );
});

test("replace whose clamped start is after uploaded end is invalid_range", () => {
  const rows = previewIncentiveRuleRows({
    restaurants,
    existing,
    kuwaitToday: "2026-10-01",
    rows: [
      { restaurant: "Talabat HQ", start: "2026-09-15", end: "2026-09-30", tiers: "50=5" },
    ],
  });
  assert.equal(rows[0].status, "invalid_range");
});

test("applyable rows are ok and would_replace only", () => {
  const rows = previewIncentiveRuleRows({
    restaurants,
    existing,
    rows: [
      { restaurant: "Missing", start: "2026-09-01", end: "2026-09-30", tiers: "50=5" },
      { restaurant: "Talabat HQ", start: "2026-09-15", end: "2026-10-15", tiers: "50=5" },
      { restaurant: "Talabat HQ", start: "2026-11-01", end: "2026-11-30", tiers: "80=10" },
    ],
  });
  const ready = applyableIncentiveImportRows(rows);
  assert.equal(ready.length, 2);
  assert.deepEqual(
    ready.map((r) => r.status),
    ["would_replace", "ok"],
  );
});
