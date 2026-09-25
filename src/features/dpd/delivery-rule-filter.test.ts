import assert from "node:assert/strict";
import { test } from "node:test";
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
