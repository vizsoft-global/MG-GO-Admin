import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canDeferDriverJoin,
  canonicalDriversGroupBy,
  canonicalDriversSearchField,
  dedupeRestaurantEdges,
  kpiRowsFromRoster,
  liveVehicleFields,
  rosterKpis,
  vehicleToRead,
} from "./driver-list-plan";

describe("driver list plan", () => {
  it("defers the driver join only for the intake-sorted default page", () => {
    const open = { tab: "all", search: null, filterCount: 0, sortKey: "name" };
    assert.equal(canDeferDriverJoin(open), true);
    assert.equal(canDeferDriverJoin({ ...open, sortKey: "phone" }), true);
    assert.equal(canDeferDriverJoin({ ...open, tab: "pending" }), false);
    assert.equal(canDeferDriverJoin({ ...open, tab: "on_duty" }), false);
    assert.equal(canDeferDriverJoin({ ...open, tab: "multi_device" }), false);
    assert.equal(canDeferDriverJoin({ ...open, tab: "archived" }), false);
    assert.equal(canDeferDriverJoin({ ...open, search: "jen" }), false);
    assert.equal(canDeferDriverJoin({ ...open, filterCount: 1 }), false);
    assert.equal(canDeferDriverJoin({ ...open, sortKey: "zone" }), false);
    assert.equal(canDeferDriverJoin({ ...open, sortKey: "status" }), false);
    assert.equal(canDeferDriverJoin({ ...open, sortKey: "todayDeliveries" }), false);
    assert.equal(canDeferDriverJoin({ ...open, sortKey: "mgId" }), false);
    assert.equal(canDeferDriverJoin({ ...open, sortKey: "cf:shirt" }), false);
  });

  it("maps the panel's snake_case search and group keys", () => {
    assert.equal(canonicalDriversSearchField("employee_id"), "employeeId");
    assert.equal(canonicalDriversSearchField("civil_id"), "civilId");
    assert.equal(canonicalDriversSearchField("not-a-field"), "all");
    assert.equal(canonicalDriversGroupBy("employee_status"), "employeeStatus");
    assert.equal(canonicalDriversGroupBy("nationality_category"), "nationalityCategory");
    assert.equal(canonicalDriversGroupBy("made-up"), "none");
  });

  it("counts each intake once, including overlapping pending flags", () => {
    const kpis = rosterKpis([
      { linkedProfileId: null, workflowStatus: "pending", accountStatus: "pending", onDuty: false },
      { linkedProfileId: "d1", workflowStatus: "approved", accountStatus: "active", onDuty: true },
      { linkedProfileId: "d2", workflowStatus: "approved", accountStatus: "active", onDuty: false },
      { linkedProfileId: "d3", workflowStatus: "pending", accountStatus: "pending", onDuty: false },
      { linkedProfileId: "d4", workflowStatus: "approved", accountStatus: "suspended", onDuty: false },
    ]);
    assert.deepEqual(kpis, {
      total: 5,
      activeToday: 2,
      onlineNow: 1,
      inactive: 1,
      pendingVerification: 2,
      suspended: 1,
    });
  });

  it("keeps one restaurant edge when the same link is read twice", () => {
    const edges = dedupeRestaurantEdges([
      { owner: "drv", restaurantId: "r1", name: "KFC" },
      { owner: "drv", restaurantId: "r1", name: "KFC" },
      { owner: "drv", restaurantId: "r2", name: "Burger" },
    ]);
    assert.deepEqual(edges.get("drv"), [
      { id: "r2", name: "Burger" },
      { id: "r1", name: "KFC" },
    ]);
  });
});

describe("tile counts from the roster in hand", () => {
  it("gives the counts the intake pass gave", () => {
    const roster = [
      { id: "i1", linked_profile_id: "d1", workflow_status: "approved" },
      { id: "i2", linked_profile_id: "d2", workflow_status: "approved" },
      { id: "i3", linked_profile_id: null, workflow_status: "pending" },
      { id: "i4", linked_profile_id: "d4", workflow_status: "approved" },
      { id: "i5", linked_profile_id: "gone", workflow_status: "approved" },
    ];
    const drivers = new Map<string, Record<string, unknown>>([
      ["d1", { status: "active", is_on_duty: true }],
      ["d2", { status: "active", is_on_duty: false }],
      ["d4", { status: "suspended", is_on_duty: false }],
      ["no-intake", { status: "active", is_on_duty: true }],
    ]);
    // What `computeFleetKpiCounts` built from the two projections.
    const fromIntakePass = roster.map((row) => {
      const driver = row.linked_profile_id ? drivers.get(row.linked_profile_id) : undefined;
      return {
        linkedProfileId: row.linked_profile_id,
        workflowStatus: row.workflow_status,
        accountStatus: (driver?.["status"] as string | undefined) ?? "pending",
        onDuty: driver ? driver["is_on_duty"] === true : false,
      };
    });
    assert.deepEqual(kpiRowsFromRoster(roster, drivers), fromIntakePass);
    assert.deepEqual(rosterKpis(kpiRowsFromRoster(roster, drivers)), {
      total: 5,
      activeToday: 2,
      onlineNow: 1,
      inactive: 1,
      pendingVerification: 2,
      suspended: 1,
    });
  });

  it("does not use a row's own status, which a deferred row does not have", () => {
    const rows = kpiRowsFromRoster(
      [{ linked_profile_id: "d1", workflow_status: "approved", account_status: "active", is_on_duty: true }],
      new Map(),
    );
    assert.deepEqual(rows, [
      { linkedProfileId: "d1", workflowStatus: "approved", accountStatus: "pending", onDuty: false },
    ]);
  });
});

describe("live vehicle fields of a page row", () => {
  type Row = Record<string, unknown>;
  const vehicles = new Map<string, Row>([
    ["v1", { reg_number: "KW-1", bike_id: "B1", vehicle_type_key: "bike" }],
    ["v2", { reg_number: null, bike_id: "B2", vehicle_type_key: "car" }],
    ["v3", { reg_number: " ", bike_id: null, vehicle_type_key: null }],
  ]);

  /** A deferred roster row, built the way `loadDriverRows` builds it. */
  function builtRow(intake: { vehicle_id: string | null; vehicle_type_key: string | null }): Row {
    const vehicle = intake.vehicle_id ? vehicles.get(intake.vehicle_id) : undefined;
    const str = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
    return {
      vehicle_id: intake.vehicle_id,
      vehicle_label: vehicle ? str(vehicle["reg_number"]) ?? str(vehicle["bike_id"]) ?? null : null,
      vehicle_type_key: (vehicle ? str(vehicle["vehicle_type_key"]) : null) ?? intake.vehicle_type_key,
      assigned_vehicle_type_key: vehicle ? str(vehicle["vehicle_type_key"]) : null,
    };
  }

  /** The fill as it was written when every vehicle was read on every opening. */
  function readEveryVehicle(row: Row, driver: Row) {
    const str = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
    const vehicleId = str(driver["vehicle_id"]) ?? str(row["vehicle_id"]);
    const vehicle = vehicleId ? vehicles.get(vehicleId) : undefined;
    return {
      vehicle_id: vehicleId,
      vehicle_label: vehicle
        ? str(vehicle["reg_number"]) ?? str(vehicle["bike_id"]) ?? null
        : str(row["vehicle_label"]),
      vehicle_type_key:
        str(driver["vehicle_type_key"]) ??
        (vehicle ? str(vehicle["vehicle_type_key"]) : null) ??
        str(row["vehicle_type_key"]),
      assigned_vehicle_type_key: vehicle ? str(vehicle["vehicle_type_key"]) : null,
    };
  }

  const intakes = [
    { vehicle_id: null, vehicle_type_key: null },
    { vehicle_id: null, vehicle_type_key: "bike" },
    { vehicle_id: "v1", vehicle_type_key: "car" },
    { vehicle_id: "v2", vehicle_type_key: null },
    { vehicle_id: "v3", vehicle_type_key: "van" },
    { vehicle_id: "missing", vehicle_type_key: "bike" },
  ];
  const driverDocs: Row[] = [
    {},
    { vehicle_id: null, vehicle_type_key: null },
    { vehicle_id: "v1" },
    { vehicle_id: "v2", vehicle_type_key: "van" },
    { vehicle_id: "v3" },
    { vehicle_id: "missing" },
    { vehicle_type_key: "car" },
  ];

  it("gives what reading every vehicle gave, for every pairing of intake and driver", () => {
    let skipped = 0;
    for (const intake of intakes) {
      for (const driver of driverDocs) {
        const row = builtRow(intake);
        const wanted = vehicleToRead(row, driver);
        if (wanted === null) skipped += 1;
        // Only what was asked for is handed over.
        const fetched = new Map<string, Row>();
        if (wanted && vehicles.has(wanted)) fetched.set(wanted, vehicles.get(wanted)!);
        assert.deepEqual(
          liveVehicleFields(row, driver, fetched),
          readEveryVehicle(row, driver),
          JSON.stringify({ intake, driver }),
        );
      }
    }
    assert.ok(skipped > 0 && skipped < intakes.length * driverDocs.length);
  });

  it("reads a vehicle only when the driver document names a different one", () => {
    const row = builtRow({ vehicle_id: "v1", vehicle_type_key: null });
    assert.equal(vehicleToRead(row, { vehicle_id: "v1" }), null);
    assert.equal(vehicleToRead(row, {}), null);
    assert.equal(vehicleToRead(row, { vehicle_id: "v2" }), "v2");
    assert.equal(vehicleToRead(builtRow({ vehicle_id: null, vehicle_type_key: null }), {}), null);
    assert.equal(
      vehicleToRead(builtRow({ vehicle_id: null, vehicle_type_key: null }), { vehicle_id: "v2" }),
      "v2",
    );
  });
});
