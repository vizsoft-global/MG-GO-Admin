import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapEventRow } from "./operation-event-row";
import { humanizeCategory, humanizeErrorCode, humanizeOperationKey, operationMessageKey } from "./operation-labels";

describe("driver operation event rows", () => {
  it("reads a rider-app row as before", () => {
    const event = mapEventRow({
      id: 7,
      driver_id: "d1",
      category: "delivery",
      operation_key: "delivery.pickup_create",
      source: "app",
      source_name: null,
      success: true,
      error_code: null,
      entity_type: "delivery",
      entity_id: "x",
      context: { a: 1 },
      latitude: "29.1",
      longitude: 48,
      device_id: null,
      app_version_code: 85,
      occurred_at: "2026-11-13T18:00:00.000Z",
      drivers: { driver_code: "10039", profiles: { full_name: " Rider One " } },
    });
    assert.equal(event.operationKey, "delivery.pickup_create");
    assert.equal(event.category, "delivery");
    assert.equal(event.driverName, "Rider One");
    assert.equal(event.latitude, 29.1);
    assert.deepEqual(event.context, { a: 1 });
  });

  it("reads a backend row, which has module and action and no operation_key", () => {
    // What `logDriverOperation` writes for a zone entry. This shape crashed Live Tracking.
    const event = mapEventRow({
      id: "abc",
      driver_id: "d1",
      module: "location",
      action: "location.zone_entry",
      actor: "driver_report_location",
      source: "rpc",
      success: true,
      record_type: "zone",
      record_id: "z1",
      detail: { from: "out_of_zone", to: "in_zone" },
      occurred_at: "2026-11-13T18:00:00.000Z",
      drivers: null,
    });
    assert.equal(event.operationKey, "location.zone_entry");
    assert.equal(event.category, "location");
    assert.equal(event.sourceName, "driver_report_location");
    assert.equal(event.entityType, "zone");
    assert.equal(event.entityId, "z1");
    assert.deepEqual(event.context, { from: "out_of_zone", to: "in_zone" });
    assert.equal(event.errorCode, null);
    assert.equal(operationMessageKey(event.operationKey), "location_zone_entry");
    assert.equal(humanizeOperationKey(event.operationKey), "Zone entry");
  });

  it("gives a row with neither key a name instead of undefined", () => {
    const event = mapEventRow({ id: 1, driver_id: "d1", occurred_at: "", drivers: null });
    assert.equal(event.operationKey, "unknown");
    assert.equal(event.category, "unknown");
    assert.equal(event.success, true);
    assert.deepEqual(event.context, {});
  });

  it("labels never throw on a missing value", () => {
    const missing = undefined as unknown as string;
    assert.equal(operationMessageKey(missing), "unknown");
    assert.equal(humanizeOperationKey(missing), "Unknown");
    assert.equal(humanizeCategory(missing), "Unknown");
    assert.equal(humanizeErrorCode(missing), "");
  });
});
