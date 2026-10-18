import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COLLECTIONS } from "../core/collections";
import type { Firestore } from "../core/fs";
import { applyAttendanceRollup, applyDeliveryRollup } from "../core/rollups";
import { fullScanFallback, prefixMatchIds } from "../core/search-query";
import { stampStoredRow } from "../core/search-text";
import { createMemoryFirestore } from "./memory-firestore";

const here = dirname(fileURLToPath(import.meta.url));
const rpc = (name: string) => readFileSync(join(here, "..", "rpcs", name), "utf8");
const searchQuery = readFileSync(join(here, "..", "core", "search-query.ts"), "utf8");

describe("search stamps on the handler function", () => {
  it("stamps create and update for every indexed entity", () => {
    const driver = {
      driver_code: "10088",
      employee_id: "108899",
      phone: "+965 5111 2222",
      client_id: "CL-9",
      client_name: "Acme",
      zone_name: "Hawally",
      partner_name: "Talabat",
      company_name: "MG",
    };
    const createdDriver = stampStoredRow("drivers", { ...driver, full_name: "Jenson Doe" });
    const updatedDriver = stampStoredRow("drivers", { ...driver, full_name: "Jane Roe" });
    assert.equal(createdDriver.name_lower, "jenson doe");
    assert.equal(updatedDriver.name_lower, "jane roe");
    assert.equal(createdDriver.driver_code_lower, "10088");
    assert.equal(createdDriver.phone_digits, "96551112222");
    assert.match(createdDriver.search_name ?? "", /jenson doe/);

    const createdIntake = stampStoredRow("driver_intakes", { ...driver, full_name: "Jenson Doe" });
    const updatedIntake = stampStoredRow("driver_intakes", { ...driver, name: "Jane Roe" });
    assert.equal(createdIntake.name_lower, "jenson doe");
    assert.equal(updatedIntake.name_lower, "jane roe");

    const createdRequest = stampStoredRow("requests", {
      request_code: "RCM-0074",
      driver_name: "Jenson Doe",
      driver_code: "10088",
      employee_id: "108899",
    });
    const updatedRequest = stampStoredRow("requests", {
      request_code: "RCM-0074",
      driver_name: "Jane Roe",
      driver_code: "10088",
      employee_id: "108899",
    });
    assert.equal(createdRequest.request_code_lower, "rcm-0074");
    assert.equal(createdRequest.driver_name_lower, "jenson doe");
    assert.equal(updatedRequest.driver_name_lower, "jane roe");
    assert.equal(updatedRequest.search_name, "rcm-0074 jane roe 10088 108899");

    const createdRestaurant = stampStoredRow("restaurants", { name: "KFC Hawally", external_merchant_id: "100" });
    const updatedRestaurant = stampStoredRow("restaurants", { name: "Burger Hub", external_merchant_id: "200" });
    assert.equal(createdRestaurant.name_lower, "kfc hawally");
    assert.equal(createdRestaurant.merchant_id_lower, "100");
    assert.equal(updatedRestaurant.name_lower, "burger hub");
    assert.equal(updatedRestaurant.search_name, "burger hub 200");

    const createdRule = stampStoredRow("delivery_rules", { name: "DPD 5" });
    const updatedRule = stampStoredRow("delivery_rules", { name: "DPD 15" });
    assert.equal(createdRule.name_lower, "dpd 5");
    assert.equal(updatedRule.name_lower, "dpd 15");
    assert.equal(updatedRule.search_name, "dpd 15");

    const createdIncentive = stampStoredRow("incentive_rules", { name: "Weekend Boost" });
    const updatedIncentive = stampStoredRow("incentive_rules", { name: "Night Boost" });
    assert.equal(createdIncentive.name_lower, "weekend boost");
    assert.equal(updatedIncentive.name_lower, "night boost");

    const createdDelivery = stampStoredRow("deliveries", {
      external_order_id: "ORD-42",
      driver_name: "Jenson Doe",
      driver_code: "10088",
      employee_id: "108899",
    });
    const updatedDelivery = stampStoredRow("deliveries", {
      external_order_id: "ORD-99",
      rider_name: "Jane Roe",
      driver_code: "10088",
      employee_id: "108899",
    });
    assert.equal(createdDelivery.order_id_lower, "ord-42");
    assert.equal(createdDelivery.rider_name_lower, "jenson doe");
    assert.equal(createdDelivery.driver_name_lower, "jenson doe");
    assert.equal(updatedDelivery.order_id_lower, "ord-99");
    assert.equal(updatedDelivery.rider_name_lower, "jane roe");
  });

  it("is the function the write handlers call", () => {
    assert.match(rpc("drivers-admin.ts"), /stampStoredRow\("drivers"/);
    assert.match(rpc("drivers-admin.ts"), /stampStoredRow\("driver_intakes"/);
    assert.match(rpc("requests-core.ts"), /stampStoredRow\("requests"/);
    assert.match(rpc("driver-requests.ts"), /stampStoredRow\("requests"/);
    assert.match(rpc("requests-workflow.ts"), /stampStoredRow\("requests"/);
    assert.match(rpc("catalogs.ts"), /stampStoredRow\("restaurants"/);
    assert.match(rpc("rules.ts"), /stampStoredRow\("delivery_rules"/);
    assert.match(rpc("rules.ts"), /stampStoredRow\("incentive_rules"/);
    assert.match(rpc("driver-deliveries.ts"), /stampStoredRow\("deliveries"/);
    assert.match(rpc("driver-deliveries.ts"), /status: "in_transit"/);
    assert.match(rpc("driver-deliveries.ts"), /touchDeliveryStatusRollup/);
    assert.match(rpc("driver-deliveries.ts"), /status: ""/);
    assert.match(rpc("deliveries-status.ts"), /stampStoredRow\("deliveries"/);
    assert.match(rpc("recon-reports.ts"), /stampStoredRow\("deliveries"/);
    assert.match(rpc("recon-reports.ts"), /applyDeliveryRollup/);
    assert.match(rpc("misc-admin.ts"), /stampStoredRow\("deliveries"/);
    assert.match(rpc("misc-admin.ts"), /applyDeliveryRollup/);
  });
});

describe("full-scan fallback", () => {
  it("stays on when the lowercase field is missing", () => {
    assert.equal(fullScanFallback(false, "jen"), true);
    assert.equal(fullScanFallback(true, "jen"), false);
    assert.equal(fullScanFallback(true, "  "), true);
    assert.equal(typeof prefixMatchIds, "function");
    assert.match(searchQuery, /Full-scan fallback/);
    assert.match(searchQuery, /export function fullScanFallback/);
    assert.match(searchQuery, /export async function prefixMatchIds/);
    assert.match(rpc("drivers.ts"), /loadDriverRows/);
    assert.doesNotMatch(rpc("drivers.ts"), /prefixMatchIds/);
    assert.match(rpc("requests-core.ts"), /fullScanFallback/);
    assert.match(rpc("requests-core.ts"), /scanRequests/);
    assert.match(rpc("rules.ts"), /fullScanFallback/);
    assert.match(rpc("rules.ts"), /collection\(collection\)\.get\(\)/);
  });
});

describe("rollup increments", () => {
  it("counts one delivery status once and one present-day once", async () => {
    const db = createMemoryFirestore();
    const firestore = db as unknown as Firestore;
    const dayId = `${COLLECTIONS.rollupsDriverDay}/drv_2026-01-05`;
    const zoneId = `${COLLECTIONS.rollupsZoneMonth}/z_2026-01`;
    const base = { deliveryId: "d1", driverId: "drv", zoneId: "z", day: "2026-01-05" };

    await applyDeliveryRollup(firestore, { ...base, status: "pending" });
    await applyDeliveryRollup(firestore, { ...base, status: "pending" });
    assert.equal(db.dump().get(dayId)?.pending, 1);

    await applyDeliveryRollup(firestore, { ...base, status: "verified" });
    await applyDeliveryRollup(firestore, { ...base, status: "verified" });
    assert.equal(db.dump().get(dayId)?.pending, 0);
    assert.equal(db.dump().get(dayId)?.verified, 1);
    assert.equal(db.dump().get(dayId)?.orders, 1);

    await applyDeliveryRollup(firestore, { ...base, deliveryId: "d2", status: "verified" });
    assert.equal(db.dump().get(dayId)?.verified, 2);
    assert.equal(db.dump().get(zoneId)?.verified, 2);
    assert.equal(db.dump().get(zoneId)?.verified_driver_days, 1);

    await applyAttendanceRollup(firestore, {
      driverId: "drv",
      zoneId: "z",
      day: "2026-01-05",
      logId: "log-1",
      present: true,
    });
    await applyAttendanceRollup(firestore, {
      driverId: "drv",
      zoneId: "z",
      day: "2026-01-05",
      logId: "log-1",
      present: true,
    });
    assert.equal(db.dump().get(dayId)?.attendance_present, 1);
    assert.equal(db.dump().get(zoneId)?.attendance_days, 1);
  });

  it("clears the old shift day when a delivery moves to the next day", async () => {
    const db = createMemoryFirestore();
    const firestore = db as unknown as Firestore;
    const oldDay = `${COLLECTIONS.rollupsDriverDay}/drv_2026-01-05`;
    const nextDay = `${COLLECTIONS.rollupsDriverDay}/drv_2026-01-06`;
    const base = { deliveryId: "d1", driverId: "drv", zoneId: "z" };
    await applyDeliveryRollup(firestore, { ...base, day: "2026-01-05", status: "in_transit" });
    await applyDeliveryRollup(firestore, { ...base, day: "2026-01-05", status: "" });
    await applyDeliveryRollup(firestore, { ...base, day: "2026-01-06", status: "pending" });
    assert.equal(db.dump().get(oldDay)?.in_transit ?? 0, 0);
    assert.equal(db.dump().get(nextDay)?.pending, 1);
  });
});
