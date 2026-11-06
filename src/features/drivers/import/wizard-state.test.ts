import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  IMPORT_WIZARD_STEPS,
  canLeaveStep,
  defaultSelectedFields,
  fieldGroup,
  missingMappedFields,
  modeToStrategy,
  nextWizardStep,
  orderSelectedFields,
  previousWizardStep,
  requiredTargetFields,
  stepIndex,
  strategyToMode,
  toggleSelectedField,
  type WizardGuardState,
} from "./wizard-state";

const guardDefaults: WizardGuardState = {
  mode: "add",
  selectedFieldCount: 3,
  headers: ["MG ID"],
  mapping: {},
  duplicateHeaderCount: 0,
  readyCount: 1,
};

test("the wizard runs mode → fields → template → upload → map → dry run → apply", () => {
  assert.deepEqual(
    [...IMPORT_WIZARD_STEPS],
    ["mode", "fields", "template", "upload", "map", "dryRun", "apply"],
  );
});

test("add maps to skip, update maps to update, and the mapping round-trips", () => {
  assert.equal(modeToStrategy("add"), "skip");
  assert.equal(modeToStrategy("update"), "update");
  assert.equal(strategyToMode("skip"), "add");
  assert.equal(strategyToMode("update"), "update");
});

test("a new employee needs all five identity fields mapped", () => {
  assert.deepEqual(
    [...requiredTargetFields("add")],
    ["full_name", "employee_id", "phone", "civil_id", "passport_number"],
  );
});

test("an update is matched on MG ID alone, so only MG ID must be mapped", () => {
  assert.deepEqual([...requiredTargetFields("update")], ["employee_id"]);
  assert.deepEqual(missingMappedFields("update", { employee_id: "MG ID" }), []);
  assert.deepEqual(
    missingMappedFields("add", { employee_id: "MG ID" }),
    ["full_name", "phone", "civil_id", "passport_number"],
  );
});

test("an update sheet starts at MG ID only; a create sheet starts with every column", () => {
  const fields = ["full_name", "employee_id", "phone"] as const;
  assert.deepEqual([...defaultSelectedFields("update", fields)], ["employee_id"]);
  assert.deepEqual([...defaultSelectedFields("add", fields)], [
    "full_name",
    "employee_id",
    "phone",
  ]);
});

test("the selection keeps catalogue order rather than click order", () => {
  assert.deepEqual(
    [
      ...orderSelectedFields(
        ["phone", "full_name"],
        ["full_name", "employee_id", "phone"],
      ),
    ],
    ["full_name", "phone"],
  );
});

test("MG ID cannot be dropped on an update; other fields toggle freely", () => {
  assert.deepEqual([...toggleSelectedField(["employee_id"], "employee_id", ["employee_id"])], [
    "employee_id",
  ]);
  assert.deepEqual([...toggleSelectedField(["employee_id"], "phone", ["employee_id"])], [
    "employee_id",
    "phone",
  ]);
  assert.deepEqual([...toggleSelectedField(["employee_id", "phone"], "phone", [])], [
    "employee_id",
  ]);
});

test("fields fall into their picker group, custom fields apart", () => {
  assert.equal(fieldGroup("employee_id"), "identity");
  assert.equal(fieldGroup("restaurant_ids"), "assignment");
  assert.equal(fieldGroup("fixed_salary"), "employment");
  assert.equal(fieldGroup("iban"), "bank");
  assert.equal(fieldGroup("work_permit_expiry"), "documents");
  assert.equal(fieldGroup("screenshots_allowed"), "flags");
  assert.equal(fieldGroup("cf:shirt_size"), "custom");
});

test("step order helpers bracket the ends", () => {
  assert.equal(stepIndex("mode"), 0);
  assert.equal(stepIndex("apply"), IMPORT_WIZARD_STEPS.length - 1);
  assert.equal(nextWizardStep("mode"), "fields");
  assert.equal(nextWizardStep("apply"), null);
  assert.equal(previousWizardStep("fields"), "mode");
  assert.equal(previousWizardStep("mode"), null);
});

test("continue is refused until the step it sits on has what it needs", () => {
  assert.equal(canLeaveStep("mode", guardDefaults), true);
  assert.equal(canLeaveStep("fields", { ...guardDefaults, selectedFieldCount: 0 }), false);
  assert.equal(canLeaveStep("template", { ...guardDefaults, headers: [] }), true);
  assert.equal(canLeaveStep("upload", { ...guardDefaults, headers: [] }), false);
  assert.equal(
    canLeaveStep("map", {
      ...guardDefaults,
      mode: "update",
      mapping: { employee_id: "MG ID" },
    }),
    true,
  );
  assert.equal(
    canLeaveStep("map", {
      ...guardDefaults,
      mode: "update",
      mapping: {},
    }),
    false,
  );
  assert.equal(
    canLeaveStep("map", {
      ...guardDefaults,
      mode: "update",
      mapping: { employee_id: "MG ID" },
      duplicateHeaderCount: 1,
    }),
    false,
  );
  assert.equal(canLeaveStep("dryRun", { ...guardDefaults, readyCount: 0 }), false);
  assert.equal(canLeaveStep("apply", guardDefaults), false);
});
