import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fleetDriverRow } from "./fleet";

/**
 * The edge room used to answer "who is this rider?" with a whole-fleet snapshot:
 * every driver, profile, location, today's shift and attendance, plus every
 * delivery of the Kuwait day — roughly 6,000-8,000 document reads. It ran on
 * every ingest batch from a rider the room was not holding, which is the normal
 * state right after a shift starts, and the loop that put the project at 2.6
 * billion reads a day.
 *
 * `buildDriverSnapshot` now reads one rider, and `fleetDriverRow` is the single
 * row builder both paths share, so the cheap read cannot describe a driver
 * differently from the full snapshot. These cases pin that contract.
 */

const NOW = Date.parse("2026-11-02T09:00:00.000Z");
const DAY = "2026-11-02";

function input(overrides: Record<string, unknown> = {}) {
  return {
    driver: {
      id: "d1",
      driver_code: "10001",
      employee_id: "1360",
      status: "active",
      is_on_duty: true,
      zone_id: "z1",
      partner_id: "p1",
      restaurant_id: "r1",
      vehicle_id: "v1",
      vehicle_type_key: "bike",
    },
    location: {
      latitude: 29.3,
      longitude: 47.9,
      speed_mps: 4.2,
      tracking_status: "moving",
      last_seen_at: new Date(NOW - 5_000).toISOString(),
      last_report_at: new Date(NOW - 5_000).toISOString(),
      distance_today_meters: 812,
    },
    profile: { full_name: "  Aadhavan  ", phone: "96512345678" },
    open: null,
    shift: {
      shift_date: DAY,
      shift_type: "morning",
      session1_start: new Date(NOW - 3_600_000).toISOString(),
      session1_end: new Date(NOW + 3_600_000).toISOString(),
    },
    onDuty: true,
    online: true,
    blocked: false,
    onDutySince: new Date(NOW - 3_600_000),
    zone: { name: "Salmiya", color: "#111111" },
    partner: { name: "Americana" },
    restaurant: { name: "KFC Salmiya" },
    vehicle: { reg_number: "12345", bike_id: "b-12345", vehicle_type_key: "car" },
    deliveriesToday: 7,
    deliveriesCompletedToday: 5,
    cutoffMs: NOW - 30 * 60_000,
    ...overrides,
  } as Parameters<typeof fleetDriverRow>[0];
}

describe("fleetDriverRow", () => {
  it("builds the row both the fleet read and the single-driver read return", () => {
    const row = fleetDriverRow(input());
    assert.ok(row);
    assert.equal(row.driver_id, "d1");
    // The profile name wins over the code, trimmed.
    assert.equal(row.driver_name, "Aadhavan");
    // The assigned vehicle's type wins over the driver's own fallback.
    assert.equal(row.vehicle_type_key, "car");
    assert.equal(row.vehicle_reg_number, "12345");
    assert.equal(row.zone_name, "Salmiya");
    assert.equal(row.partner_name, "Americana");
    assert.equal(row.restaurant_name, "KFC Salmiya");
    assert.equal(row.phone, "96512345678");
    assert.equal(row.deliveries_today, 7);
    assert.equal(row.deliveries_completed_today, 5);
    assert.equal(row.distance_today_meters, 812);
    assert.equal(row.is_on_duty, true);
    assert.equal(row.is_online, true);
    assert.equal(row.shift?.shift_type, "morning");
  });

  it("falls back to the driver code when the profile has no name", () => {
    const row = fleetDriverRow(input({ profile: { full_name: "   " } }));
    assert.equal(row?.driver_name, "10001");
  });

  it("returns null for a rider the rail should not hold, so the room asks again later", () => {
    // Off duty, offline, not blocked, no open pickup and a fix older than the
    // window: this is exactly the rider whose every batch used to trigger a full
    // fleet scan.
    const row = fleetDriverRow(
      input({
        onDuty: false,
        online: false,
        blocked: false,
        open: null,
        location: {
          last_seen_at: new Date(NOW - 2 * 60 * 60_000).toISOString(),
          last_report_at: new Date(NOW - 2 * 60 * 60_000).toISOString(),
        },
      }),
    );
    assert.equal(row, null);
  });

  it("keeps an on-duty rider with no fresh fix", () => {
    const row = fleetDriverRow(
      input({
        location: {
          last_seen_at: new Date(NOW - 2 * 60 * 60_000).toISOString(),
          last_report_at: new Date(NOW - 2 * 60 * 60_000).toISOString(),
        },
      }),
    );
    assert.ok(row);
    assert.equal(row.driver_id, "d1");
  });

  it("keeps a rider with an open pickup even when idle and offline", () => {
    const row = fleetDriverRow(
      input({
        onDuty: false,
        online: false,
        open: { id: "del-1", pickupAt: new Date(NOW - 600_000), createdAt: null },
        location: {
          last_seen_at: new Date(NOW - 2 * 60 * 60_000).toISOString(),
          last_report_at: new Date(NOW - 2 * 60 * 60_000).toISOString(),
        },
      }),
    );
    assert.ok(row);
    assert.equal(row.active_delivery_id, "del-1");
  });
});
