import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previewVehicleImport, type VehicleImportExisting } from "./vehicle-import-preview";
import {
  clearRedo,
  redoRowPlan,
  redoTargetId,
  undoRowPlan,
  undoTargetId,
  type VehicleImportBatchTip,
} from "./vehicle-import-stack";

const headers = ["Vehicle ID", "Plate No.", "Kind"];

function existing(overrides: Partial<VehicleImportExisting> = {}): VehicleImportExisting {
  return {
    id: "veh-1",
    bike_id: "BIKE1",
    reg_number: "5/6767",
    chassis_no: null,
    make: null,
    model: null,
    model_year: null,
    vehicle_type_key: "bike",
    project_type: "group",
    status: "active",
    location_text: null,
    condition: null,
    car_type: null,
    type_of_use: null,
    fuel_type: null,
    fuel_company: null,
    chip_no: null,
    fuel_monthly_limit_kwd: 30,
    ...overrides,
  };
}

describe("vehicle import preview", () => {
  it("creates a new bike when the id is unknown and kind is blank", () => {
    const result = previewVehicleImport({
      headers,
      rows: [["NEW1", "", ""]],
      existing: [],
    });
    assert.equal(result.rows[0]?.status, "create");
    assert.equal(result.rows[0]?.after?.vehicle_type_key, "bike");
    assert.equal(result.rows[0]?.before, null);
  });

  it("updates an existing vehicle and clears a blank plate", () => {
    const result = previewVehicleImport({
      headers,
      rows: [["BIKE1", "", "car"]],
      existing: [existing()],
    });
    assert.equal(result.rows[0]?.status, "update");
    assert.equal(result.rows[0]?.before?.reg_number, "5/6767");
    assert.equal(result.rows[0]?.after?.reg_number, null);
    assert.equal(result.rows[0]?.after?.vehicle_type_key, "car");
  });

  it("rejects both rows when the same Vehicle ID appears twice", () => {
    const result = previewVehicleImport({
      headers,
      rows: [
        ["DUP1", "5/1", "bike"],
        ["DUP1", "5/2", "bike"],
      ],
      existing: [],
    });
    assert.equal(result.rows.length, 2);
    assert.deepEqual(
      result.rows.map((row) => row.error),
      ["duplicate_in_file", "duplicate_in_file"],
    );
  });

  it("rejects a bad plate and keeps the other row", () => {
    const result = previewVehicleImport({
      headers,
      rows: [
        ["OK1", "5/6767", "bike"],
        ["BAD1", "88", "bike"],
      ],
      existing: [],
    });
    assert.equal(result.rows[0]?.status, "create");
    assert.equal(result.rows[1]?.status, "error");
    assert.equal(result.rows[1]?.error, "invalid_plate");
  });
});

describe("vehicle import undo and redo", () => {
  const inserted = {
    outcome: "create" as const,
    vehicleId: "new-id",
    before: null,
    after: { bike_id: "NEW1" },
  };
  const updated = {
    outcome: "update" as const,
    vehicleId: "veh-1",
    before: { reg_number: "5/6767" },
    after: { reg_number: null },
  };

  it("undo deletes an insert and restores before on an update", () => {
    assert.deepEqual(undoRowPlan(inserted), { op: "delete", vehicleId: "new-id" });
    assert.deepEqual(undoRowPlan(updated), {
      op: "restore",
      vehicleId: "veh-1",
      snapshot: updated.before,
    });
  });

  it("redo writes the after snapshot", () => {
    assert.equal(redoRowPlan(updated)?.snapshot, updated.after);
    assert.equal(redoRowPlan({ ...inserted, outcome: "failed" }), null);
  });

  it("a new import removes redo", () => {
    const batches: VehicleImportBatchTip[] = [
      {
        id: "a",
        status: "undone",
        createdAt: "2026-09-24T01:00:00Z",
        undoSeq: 1,
        redoable: true,
      },
      {
        id: "b",
        status: "applied",
        createdAt: "2026-09-24T02:00:00Z",
        undoSeq: null,
        redoable: true,
      },
    ];
    assert.equal(undoTargetId(batches), "b");
    assert.equal(redoTargetId(batches), "a");
    const afterImport = clearRedo(batches);
    assert.equal(redoTargetId(afterImport), null);
    assert.equal(undoTargetId(afterImport), "b");
  });
});
