import assert from "node:assert/strict";
import test from "node:test";
import type { CustomColumnDef, RosterRow } from "@/features/operations-dashboard/shape";
import {
  materialiseRosterColumns,
  moveRosterColumn,
  newRosterCustomColumn,
  planRosterColumns,
  rosterCustomFieldText,
  visibleRosterColumns,
} from "@/features/operations-dashboard-v2/custom-columns";

function entry(patch: Partial<CustomColumnDef> & { field: string }): CustomColumnDef {
  return { id: patch.id ?? patch.field, label: patch.label ?? "", visible: patch.visible ?? true, ...patch };
}

test("a definition that names no base field still shows every base column", () => {
  const plan = planRosterColumns([], { includePhone: true });
  assert.deepEqual(
    plan.map((column) => column.id),
    [
      "employeeId",
      "name",
      "project",
      "zone",
      "status",
      "joined",
      "nationalityCategory",
      "nationalityCountry",
      "phone",
    ],
  );
  assert.ok(plan.every((column) => column.kind === "base"));
});

test("a legacy entry keyed by its own id maps onto the base field instead of duplicating it", () => {
  const plan = planRosterColumns(
    [entry({ id: "col_nationality_country", field: "nationalityCountry", label: "Nationality Country" })],
    { includePhone: true },
  );
  const matches = plan.filter((column) => column.id === "nationalityCountry");
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.kind, "base");
});

test("a base column renames only through customLabel, so a legacy English label cannot leak into Arabic", () => {
  const legacy = planRosterColumns([entry({ field: "name", label: "Rider Name" })], { includePhone: true });
  assert.equal(legacy.find((column) => column.id === "name")?.label, "");

  const renamed = planRosterColumns(
    [entry({ field: "name", label: "Rider Name", customLabel: "Rider" })],
    { includePhone: true },
  );
  assert.equal(renamed.find((column) => column.id === "name")?.label, "Rider");
});

test("hiding keeps the column in the plan so it can be switched back on", () => {
  const plan = planRosterColumns([entry({ field: "zone", visible: false })], { includePhone: true });
  assert.equal(plan.find((column) => column.id === "zone")?.visible, false);
  assert.ok(!visibleRosterColumns(plan).some((column) => column.id === "zone"));
});

test("a driver custom field becomes a prefixed column at the position the config gives it", () => {
  const plan = planRosterColumns(
    [
      entry({ field: "employeeId" }),
      entry({ id: "cf:badge_no", field: "badge_no", label: "Badge" }),
    ],
    { includePhone: true },
  );
  assert.deepEqual(
    plan.slice(0, 3).map((column) => column.id),
    ["employeeId", "cf:badge_no", "name"],
  );
  assert.equal(plan[1]?.kind, "custom");
  assert.equal(plan[1]?.label, "Badge");
});

test("phone is dropped for a partner session even when the definition stores it", () => {
  const plan = planRosterColumns(
    [entry({ field: "phone" }), entry({ field: "name" })],
    { includePhone: false },
  );
  assert.ok(!plan.some((column) => column.field === "phone"));
  assert.deepEqual(plan.map((column) => column.id), [
    "name",
    "employeeId",
    "project",
    "zone",
    "status",
    "joined",
    "nationalityCategory",
    "nationalityCountry",
  ]);
});

test("materialising writes the base fields out so reordering stays stable", () => {
  const stored = materialiseRosterColumns([entry({ field: "zone" })], { includePhone: true });
  assert.equal(stored.length, 9);
  assert.equal(stored[0]?.field, "zone");
  assert.equal(stored[1]?.field, "employeeId");
  assert.equal(stored[0]?.label, "");
  assert.ok(stored.every((column) => typeof column.visible === "boolean"));
});

test("moving a column clamps at both ends", () => {
  const columns = materialiseRosterColumns([], { includePhone: true });
  const first = columns[0]!.id;
  assert.deepEqual(moveRosterColumn(columns, first, -1).map((column) => column.id), columns.map((column) => column.id));

  const moved = moveRosterColumn(columns, first, 1);
  assert.equal(moved[0]?.id, columns[1]?.id);
  assert.equal(moved[1]?.id, first);

  const last = columns[columns.length - 1]!.id;
  assert.deepEqual(
    moveRosterColumn(columns, last, 1).map((column) => column.id),
    columns.map((column) => column.id),
  );
  assert.deepEqual(moveRosterColumn(columns, "missing", 1).map((column) => column.id), columns.map((column) => column.id));
});

test("a new custom column takes its key as id and falls back to the key as its heading", () => {
  const column = newRosterCustomColumn("badge_no", "  ");
  assert.equal(column.id, "cf:badge_no");
  assert.equal(column.field, "badge_no");
  assert.equal(column.label, "badge_no");
  assert.equal(column.visible, true);
});

test("a custom value prints the way the roster cell expects", () => {
  assert.equal(rosterCustomFieldText("Doha"), "Doha");
  assert.equal(rosterCustomFieldText(["A", "B"]), "A, B");
  assert.equal(rosterCustomFieldText([]), "—");
  assert.equal(rosterCustomFieldText(true), "Yes");
  assert.equal(rosterCustomFieldText(12), "12");
  assert.equal(rosterCustomFieldText(null), "—");
  assert.equal(rosterCustomFieldText("   "), "—");
});

test("the plan reads the rider's own custom field, not a base property", () => {
  const row: RosterRow = {
    employeeId: "10001",
    name: "Rider",
    project: "keeta",
    zone: "Salmiya",
    status: "working",
    statuses: ["working"],
    joined: "2026-01-01",
    phone: "5555",
    customFields: { badge_no: "B-19" },
  };
  assert.equal(rosterCustomFieldText(row.customFields?.badge_no), "B-19");
});
