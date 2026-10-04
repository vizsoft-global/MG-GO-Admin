import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deliveryRuleFieldForError,
  validateDeliveryRuleForm,
  type ValidateDeliveryRuleFormInput,
} from "./delivery-rule-form-validation";
import { filterDeliveryRules, type DeliveryRuleFilterable } from "./delivery-rule-filter";

function row(
  partial: Partial<DeliveryRuleFilterable> & Pick<DeliveryRuleFilterable, "name">,
): DeliveryRuleFilterable {
  return {
    scope_label: "KFC Hawally",
    scope_search: "KFC Hawally 9a1b2c3d-0000-0000-0000-000000000001 M-100",
    ...partial,
  };
}

const rows: DeliveryRuleFilterable[] = [
  row({
    name: "Hawally daily",
    scope_label: "KFC Hawally",
    scope_search: "KFC Hawally 9a1b2c3d-0000-0000-0000-000000000001 M-100",
  }),
  row({
    name: "Jahra zone",
    scope_label: "Jahra (JAH)",
    scope_search: "Jahra JAH zone-id-2",
  }),
  row({
    name: "North zone weekly",
    scope_label: "Farwaniya (FRW)",
    scope_search: "Farwaniya FRW zone-id-3",
  }),
];

test("empty query returns every row", () => {
  assert.deepEqual(filterDeliveryRules(rows, ""), rows);
  assert.deepEqual(filterDeliveryRules(rows, "   "), rows);
});

test("query matches rule name", () => {
  assert.deepEqual(
    filterDeliveryRules(rows, "  HAWALLY   daily ").map((r) => r.name),
    ["Hawally daily"],
  );
});

test("query matches scope label", () => {
  assert.deepEqual(
    filterDeliveryRules(rows, "jahra").map((r) => r.name),
    ["Jahra zone"],
  );
});

test("query matches restaurant id and external merchant id", () => {
  assert.deepEqual(
    filterDeliveryRules(rows, "9a1b2c3d-0000-0000-0000-000000000001").map((r) => r.name),
    ["Hawally daily"],
  );
  assert.deepEqual(
    filterDeliveryRules(rows, "m-100").map((r) => r.name),
    ["Hawally daily"],
  );
});

// QA #26: a zone search has to hit both the zone name and its code, and it has
// to do so through the scope text rather than through a rule name that happens
// to contain the same letters — the row below is named so that neither needle
// can be found any other way.
test("query matches zone name and zone code from the scope text", () => {
  assert.deepEqual(
    filterDeliveryRules(rows, "farwaniya").map((r) => r.name),
    ["North zone weekly"],
  );
  assert.deepEqual(
    filterDeliveryRules(rows, "frw").map((r) => r.name),
    ["North zone weekly"],
  );
});

// QA #8: the rule form validates each field so a failure names the field that
// caused it instead of collapsing into one generic message.
function validInput(
  overrides: Partial<ValidateDeliveryRuleFormInput> = {},
): ValidateDeliveryRuleFormInput {
  return {
    name: "Hawally daily",
    scopeType: "restaurant",
    zoneIds: [],
    partnerIds: [],
    restaurantIds: ["9a1b2c3d-0000-0000-0000-000000000001"],
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    dpdTarget: "10",
    priority: "30",
    ...overrides,
  };
}

test("a complete form has no field errors", () => {
  assert.deepEqual(validateDeliveryRuleForm(validInput()), {});
});

test("a blank name names the name field", () => {
  assert.deepEqual(validateDeliveryRuleForm(validInput({ name: "   " })), {
    name: "name_required",
  });
});

test("an empty scope set names the scope field", () => {
  assert.deepEqual(
    validateDeliveryRuleForm(validInput({ restaurantIds: [] })),
    { scopeIds: "invalid_scope" },
  );
  assert.deepEqual(
    validateDeliveryRuleForm(
      validInput({ scopeType: "zone", zoneIds: [], restaurantIds: [] }),
    ),
    { scopeIds: "invalid_scope" },
  );
  assert.deepEqual(
    validateDeliveryRuleForm(
      validInput({ scopeType: "partner", partnerIds: [], restaurantIds: [] }),
    ),
    { scopeIds: "invalid_scope" },
  );
});

test("a missing date is required, a reversed window is invalid", () => {
  assert.deepEqual(
    validateDeliveryRuleForm(validInput({ startDate: "" })),
    { startDate: "missing_fields" },
  );
  assert.deepEqual(
    validateDeliveryRuleForm(validInput({ endDate: "" })),
    { endDate: "missing_fields" },
  );
  assert.deepEqual(
    validateDeliveryRuleForm(
      validInput({ startDate: "2026-02-01", endDate: "2026-01-31" }),
    ),
    { endDate: "invalid_dates" },
  );
});

test("a non-positive target is invalid but a blank one is allowed", () => {
  assert.deepEqual(
    validateDeliveryRuleForm(validInput({ dpdTarget: "0" })),
    { dpdTarget: "invalid_target" },
  );
  assert.deepEqual(
    validateDeliveryRuleForm(validInput({ dpdTarget: "abc" })),
    { dpdTarget: "invalid_target" },
  );
  assert.deepEqual(validateDeliveryRuleForm(validInput({ dpdTarget: "" })), {});
});

test("a non-numeric priority is invalid but a blank one is allowed", () => {
  assert.deepEqual(
    validateDeliveryRuleForm(validInput({ priority: "high" })),
    { priority: "invalid_priority" },
  );
  assert.deepEqual(validateDeliveryRuleForm(validInput({ priority: "" })), {});
});

test("a server rejection maps back to the field it belongs to", () => {
  assert.equal(deliveryRuleFieldForError("name_required"), "name");
  assert.equal(deliveryRuleFieldForError("invalid_scope"), "scopeIds");
  assert.equal(deliveryRuleFieldForError("invalid_dates"), "endDate");
  assert.equal(deliveryRuleFieldForError("invalid_target"), "dpdTarget");
  assert.equal(deliveryRuleFieldForError("invalid_priority"), "priority");
  // Unmapped keys are toasted rather than pinned to a field that may be fine.
  assert.equal(deliveryRuleFieldForError("missing_fields"), null);
  assert.equal(deliveryRuleFieldForError("save_failed"), null);
  assert.equal(deliveryRuleFieldForError("not_authorized"), null);
});
