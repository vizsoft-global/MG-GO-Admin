import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASSISTANT_ENTITY_TYPES, ENTITY_MODULE_PERMISSION, FLEET_ENTITY_ID } from "./assistant-entity";
import { RELATED_RELATIONS, capLimit, relatedPayload } from "./assistant-related";
import { sectionDenied, sectionUnavailable, stripDriverIdentity } from "./assistant-strip";

describe("entity report contract", () => {
  it("covers every planned entity type with a module permission", () => {
    for (const type of ASSISTANT_ENTITY_TYPES) {
      assert.ok(ENTITY_MODULE_PERMISSION[type], type);
    }
    assert.ok(ASSISTANT_ENTITY_TYPES.includes("driver"));
    assert.ok(ASSISTANT_ENTITY_TYPES.includes("fleet"));
    assert.ok(ASSISTANT_ENTITY_TYPES.includes("complaint"));
    assert.equal(FLEET_ENTITY_ID, "fleet");
  });

  it("builds a driver identity card without passcode or civil id", () => {
    const card = stripDriverIdentity(
      {
        id: "d1",
        full_name: "Noura",
        driver_code: "10210",
        phone: "555",
        email: "n@x.com",
        app_passcode: "999999",
        civil_id: "cid",
        account_status: "active",
        zone_label: "Jahra",
      },
      { showContact: true },
    );
    assert.equal(card.name, "Noura");
    assert.equal(card.phone, "555");
    assert.ok(!("app_passcode" in card));
    assert.ok(!("civil_id" in card));
  });

  it("uses not_authorized / unavailable section shapes instead of invented numbers", () => {
    assert.deepEqual(sectionDenied("/payroll"), { error: "not_authorized", page: "/payroll" });
    assert.deepEqual(sectionUnavailable("requests_have_no_restaurant_id"), {
      error: "unavailable",
      reason: "requests_have_no_restaurant_id",
    });
  });
});

describe("list_related contract", () => {
  it("caps heads at 20 and always returns a count", () => {
    assert.equal(capLimit(99), 20);
    assert.equal(capLimit(0), 1);
    assert.equal(capLimit(), 10);
    assert.deepEqual(relatedPayload(7, [{ id: "1" }]), { count: 7, head: [{ id: "1" }] });
    for (const relation of [
      "complaints",
      "restaurants",
      "pending_requests",
      "drivers",
      "vehicles",
      "deliveries",
    ]) {
      assert.ok((RELATED_RELATIONS as readonly string[]).includes(relation));
    }
  });
});
