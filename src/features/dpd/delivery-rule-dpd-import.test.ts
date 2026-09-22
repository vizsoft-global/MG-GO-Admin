import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyableDpdTargetRows,
  BULK_DPD_CREATE_PRIORITY,
  guessDpdTargetImportColumns,
  mapDpdTargetImportSheet,
  previewDpdTargetRows,
} from "./delivery-rule-dpd-import";

const restaurants = [
  { id: "r1", name: "Al Abdullah Club", partner_name: "Talabat" },
  { id: "r2", name: "Al Abdullah Club", partner_name: "Deliveroo" },
  { id: "r3", name: "Crystal Tower", partner_name: "Talabat" },
];
const zones = [
  { id: "z1", name: "Hawally", code: "ZN-HAW" },
  { id: "z2", name: "Hawally", code: "ZN-HAW2" },
  { id: "z3", name: "Jahra", code: "ZN-JAH" },
];
const rules = [
  {
    id: "rule-1",
    name: "Crystal Tower",
    status: "active",
    priority: 5,
    scope_type: "restaurant" as const,
    restaurant_ids: ["r3"],
    zone_ids: [],
  },
];

test("bulk create priorities match the form defaults", () => {
  assert.equal(BULK_DPD_CREATE_PRIORITY.restaurant, 30);
  assert.equal(BULK_DPD_CREATE_PRIORITY.zone, 10);
});

test("create when no rule; update when one exists", () => {
  const rows = previewDpdTargetRows({
    restaurants,
    zones,
    rules,
    rows: [
      { scope_type: "restaurant", name: "Crystal Tower", dpd_target: "20", dpd_period: "daily" },
      { scope_type: "zone", name: "Jahra", dpd_target: "25", dpd_period: "weekly" },
    ],
  });
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[0].rule_id, "rule-1");
  assert.equal(rows[1].status, "create");
  assert.equal(rows[1].scope_id, "z3");
  assert.equal(rows[1].resolved_scope, "zone");
});

test("3-column infer picks restaurant-only or zone-only names", () => {
  const rows = previewDpdTargetRows({
    restaurants,
    zones,
    rules: [],
    rows: [
      { name: "Crystal Tower", dpd_target: "20", dpd_period: "daily" },
      { name: "Jahra", dpd_target: "25", dpd_period: "monthly" },
    ],
  });
  assert.equal(rows[0].status, "create");
  assert.equal(rows[0].resolved_scope, "restaurant");
  assert.equal(rows[1].status, "create");
  assert.equal(rows[1].resolved_scope, "zone");
});

test("ambiguous restaurant names stay rejected without Partner", () => {
  const rows = previewDpdTargetRows({
    restaurants,
    zones,
    rules: [],
    rows: [
      { scope_type: "restaurant", name: "Al Abdullah Club", dpd_target: "20", dpd_period: "daily" },
    ],
  });
  assert.equal(rows[0].status, "ambiguous_name");
  assert.equal(rows[0].note, "Talabat, Deliveroo");
  assert.equal(rows[0].scope_id, null);
});

test("Partner column disambiguates two same-named restaurants", () => {
  const rows = previewDpdTargetRows({
    restaurants,
    zones,
    rules: [],
    rows: [
      {
        scope_type: "restaurant",
        name: "Al Abdullah Club",
        partner: "Deliveroo",
        dpd_target: "20",
        dpd_period: "daily",
      },
    ],
  });
  assert.equal(rows[0].status, "create");
  assert.equal(rows[0].scope_id, "r2");
});

test("ambiguous zone names stay rejected without Zone Code", () => {
  const rows = previewDpdTargetRows({
    restaurants,
    zones,
    rules: [],
    rows: [{ scope_type: "zone", name: "Hawally", dpd_target: "25", dpd_period: "weekly" }],
  });
  assert.equal(rows[0].status, "ambiguous_name");
  assert.equal(rows[0].note, "ZN-HAW, ZN-HAW2");
});

test("Zone Code disambiguates two same-named zones", () => {
  const rows = previewDpdTargetRows({
    restaurants,
    zones,
    rules: [],
    rows: [
      {
        scope_type: "zone",
        name: "Hawally",
        zone_code: "zn-haw2",
        dpd_target: "25",
        dpd_period: "weekly",
      },
    ],
  });
  assert.equal(rows[0].status, "create");
  assert.equal(rows[0].scope_id, "z2");
});

test("in-file duplicate: second same restaurant is rejected", () => {
  const rows = previewDpdTargetRows({
    restaurants,
    zones,
    rules: [],
    rows: [
      { scope_type: "restaurant", name: "Crystal Tower", dpd_target: "20", dpd_period: "daily" },
      { scope_type: "restaurant", name: "crystal tower", dpd_target: "22", dpd_period: "weekly" },
    ],
  });
  assert.equal(rows[0].status, "create");
  assert.equal(rows[0].scope_id, "r3");
  assert.equal(rows[1].status, "duplicate");
  assert.equal(rows[1].scope_id, "r3");
});

test("in-file duplicate: second same zone is rejected", () => {
  const rows = previewDpdTargetRows({
    restaurants,
    zones,
    rules: [],
    rows: [
      { scope_type: "zone", name: "Jahra", dpd_target: "25", dpd_period: "daily" },
      { scope_type: "zone", name: "Jahra", dpd_target: "30", dpd_period: "daily" },
    ],
  });
  assert.equal(rows[0].status, "create");
  assert.equal(rows[1].status, "duplicate");
});

test("same display name as restaurant and zone is not a duplicate when scoped", () => {
  const mixed = [
    ...restaurants,
    { id: "r-jah", name: "Jahra", partner_name: "Talabat" },
  ];
  const rows = previewDpdTargetRows({
    restaurants: mixed,
    zones,
    rules: [],
    rows: [
      { scope_type: "restaurant", name: "Jahra", dpd_target: "20", dpd_period: "daily" },
      { scope_type: "zone", name: "Jahra", dpd_target: "25", dpd_period: "daily" },
    ],
  });
  assert.equal(rows[0].status, "create");
  assert.equal(rows[0].resolved_scope, "restaurant");
  assert.equal(rows[1].status, "create");
  assert.equal(rows[1].resolved_scope, "zone");
});

test("unknown name and invalid period are rejected", () => {
  const rows = previewDpdTargetRows({
    restaurants,
    zones,
    rules: [],
    rows: [
      { name: "Missing", dpd_target: "20", dpd_period: "daily" },
      { name: "Crystal Tower", dpd_target: "20", dpd_period: "yearly" },
      { name: "Jahra", dpd_target: "0", dpd_period: "daily" },
    ],
  });
  assert.equal(rows[0].status, "unknown_name");
  assert.equal(rows[1].status, "invalid_period");
  assert.equal(rows[2].status, "invalid_target");
});

test("Partner Name does not steal the Name column", () => {
  const cols = guessDpdTargetImportColumns([
    "Restaurant / Zone Name",
    "Partner Name",
    "DPD Target",
    "DPD Target Period",
  ]);
  assert.deepEqual(cols, {
    scope_type: -1,
    name: 0,
    dpd_target: 2,
    dpd_period: 3,
    partner: 1,
    zone_code: -1,
  });
  const mapped = mapDpdTargetImportSheet(
    ["Restaurant / Zone Name", "Partner Name", "DPD Target", "DPD Target Period"],
    [["Al Abdullah Club", "Talabat", "20", "daily"]],
  );
  assert.equal(mapped[0]?.name, "Al Abdullah Club");
  assert.equal(mapped[0]?.partner, "Talabat");
});

test("old Scope Type headers still map", () => {
  const mapped = mapDpdTargetImportSheet(
    ["Scope Type", "Name", "DPD Target", "Period"],
    [["restaurant", "Crystal Tower", "20", "daily"]],
  );
  assert.equal(mapped[0]?.scope_type, "restaurant");
  assert.equal(mapped[0]?.name, "Crystal Tower");
});

test("applyable rows are create and update only", () => {
  const rows = previewDpdTargetRows({
    restaurants,
    zones,
    rules,
    rows: [
      { name: "Missing", dpd_target: "20", dpd_period: "daily" },
      { scope_type: "restaurant", name: "Crystal Tower", dpd_target: "20", dpd_period: "daily" },
      { scope_type: "zone", name: "Jahra", dpd_target: "25", dpd_period: "daily" },
      { scope_type: "zone", name: "Jahra", dpd_target: "30", dpd_period: "daily" },
    ],
  });
  const ready = applyableDpdTargetRows(rows);
  assert.deepEqual(
    ready.map((r) => r.status),
    ["ok", "create"],
  );
});
