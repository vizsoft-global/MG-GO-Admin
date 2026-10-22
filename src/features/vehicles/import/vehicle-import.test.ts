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
    company_id: null,
    owner_partner_id: null,
    registration_issued_at: null,
    registration_expires_at: null,
    insurance_issued_at: null,
    insurance_expires_at: null,
    replaces_vehicle_id: null,
    replacement_started_at: null,
    assigned_driver_id: null,
    ...overrides,
  };
}

describe("vehicle import preview", () => {
  it("creates a new bike when the plate is unknown and kind is blank", () => {
    const result = previewVehicleImport({
      headers,
      rows: [["9/1001", "", ""]],
      existing: [],
    });
    assert.equal(result.rows[0]?.status, "create");
    assert.equal(result.rows[0]?.after?.vehicle_type_key, "bike");
    assert.equal(result.rows[0]?.after?.bike_id, "9-1001");
    assert.equal(result.rows[0]?.after?.reg_number, "9/1001");
    assert.equal(result.rows[0]?.before, null);
  });

  it("updates an existing vehicle by plate and keeps the plate", () => {
    const result = previewVehicleImport({
      headers,
      rows: [["5/6767", "", "car"]],
      existing: [existing()],
    });
    assert.equal(result.rows[0]?.status, "update");
    assert.equal(result.rows[0]?.before?.reg_number, "5/6767");
    assert.equal(result.rows[0]?.after?.reg_number, "5/6767");
    assert.equal(result.rows[0]?.after?.bike_id, "5-6767");
    assert.equal(result.rows[0]?.after?.vehicle_type_key, "car");
  });

  it("rejects both rows when the same plate appears twice", () => {
    const result = previewVehicleImport({
      headers,
      rows: [
        ["5/1", "5/1", "bike"],
        ["5/1", "5/1", "bike"],
      ],
      existing: [],
    });
    assert.equal(result.rows.length, 2);
    assert.deepEqual(
      result.rows.map((row) => row.error),
      ["duplicate_plate", "duplicate_plate"],
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

describe("vehicle import v2 — context and blank/dash semantics", () => {
  const drivers = [
    { id: "drv-1", employee_id: "MG-10231" },
    { id: "drv-2", employee_id: "MG-20000" },
  ];
  const companies = [{ key: "musallam", label_en: "Musallam Group", label_ar: "مجموعة مسلم" }];

  it("creates a new vehicle and plans the rider assignment from the MG ID", () => {
    const result = previewVehicleImport({
      headers: ["Vehicle ID", "MG ID"],
      rows: [["9/1001", "MG-10231"]],
      existing: [],
      drivers,
    });
    const row = result.rows[0];
    assert.equal(row?.status, "create");
    assert.equal(row?.driverId, "drv-1");
    assert.equal(row?.driverBefore, null);
    assert.equal(row?.driverAction, "assign");
  });

  it("keeps a blank cell and clears with a dash", () => {
    const result = previewVehicleImport({
      headers: ["Vehicle ID", "Make", "Model", "Chip No."],
      rows: [["5/6767", "", "", "-"]],
      existing: [existing({ make: "Honda", model: "Wave", chip_no: "CHIP-1" })],
    });
    const row = result.rows[0];
    assert.equal(row?.after?.make, "Honda", "blank keeps the make");
    assert.equal(row?.after?.model, "Wave", "blank keeps the model");
    assert.equal(row?.after?.chip_no, null, "a dash clears the chip");
    assert.deepEqual(row?.clearedFields, ["chipNo"]);
  });

  it("fails the row when the MG ID is unknown", () => {
    const result = previewVehicleImport({
      headers: ["Vehicle ID", "MG ID"],
      rows: [["9/1001", "MG-99999"]],
      existing: [],
      drivers,
    });
    assert.equal(result.rows[0]?.status, "error");
    assert.equal(result.rows[0]?.error, "unknown_driver");
    assert.equal(result.rows[0]?.driverId, null);
  });

  it("fails an MG ID that matches two riders", () => {
    const result = previewVehicleImport({
      headers: ["Vehicle ID", "MG ID"],
      rows: [["9/1001", "MG-1"]],
      existing: [],
      drivers: [
        { id: "a", employee_id: "MG-1" },
        { id: "b", employee_id: "mg-1" },
      ],
    });
    assert.equal(result.rows[0]?.error, "ambiguous_driver");
  });

  it("keeps the rider on a blank cell and unassigns on a dash", () => {
    const kept = previewVehicleImport({
      headers: ["Vehicle ID", "MG ID"],
      rows: [["5/6767", ""]],
      existing: [existing({ assigned_driver_id: "drv-2" })],
      drivers,
    });
    assert.equal(kept.rows[0]?.driverAction, "keep");
    assert.equal(kept.rows[0]?.driverBefore, "drv-2");

    const cleared = previewVehicleImport({
      headers: ["Vehicle ID", "MG ID"],
      rows: [["5/6767", "-"]],
      existing: [existing({ assigned_driver_id: "drv-2" })],
      drivers,
    });
    assert.equal(cleared.rows[0]?.driverAction, "clear");
    assert.equal(cleared.rows[0]?.driverBefore, "drv-2");
    assert.equal(cleared.rows[0]?.driverId, null);
  });

  it("resolves the vehicle company by key or label and rejects an unknown one", () => {
    const byKey = previewVehicleImport({
      headers: ["Vehicle ID", "Vehicle Company"],
      rows: [["5/6767", "musallam"]],
      existing: [existing()],
      companies,
    });
    assert.equal(byKey.rows[0]?.after?.company_id, "musallam");

    const byLabel = previewVehicleImport({
      headers: ["Vehicle ID", "Vehicle Company"],
      rows: [["5/6767", "Musallam Group"]],
      existing: [existing()],
      companies,
    });
    assert.equal(byLabel.rows[0]?.after?.company_id, "musallam");

    const unknown = previewVehicleImport({
      headers: ["Vehicle ID", "Vehicle Company"],
      rows: [["5/6767", "nope"]],
      existing: [existing()],
      companies,
    });
    assert.equal(unknown.rows[0]?.error, "unknown_company");
  });

  it("resolves the owner partner by name and rejects an unknown one", () => {
    const partners = [{ id: "par-1", name: "Musallam Group" }];
    const ok = previewVehicleImport({
      headers: ["Vehicle ID", "Partner"],
      rows: [["5/6767", "musallam group"]],
      existing: [existing()],
      partners,
    });
    assert.equal(ok.rows[0]?.after?.owner_partner_id, "par-1");

    const bad = previewVehicleImport({
      headers: ["Vehicle ID", "Partner"],
      rows: [["5/6767", "Someone Else"]],
      existing: [existing()],
      partners,
    });
    assert.equal(bad.rows[0]?.error, "unknown_partner");
  });
});

describe("vehicle import v2 — document dates and replacement", () => {
  it("stores document dates as Kuwait midnight and blocks an expiry before issue", () => {
    const ok = previewVehicleImport({
      headers: [
        "Vehicle ID",
        "Registration issued",
        "Registration expiry",
        "Insurance issued",
        "Insurance expiry",
      ],
      rows: [["5/6767", "2025-01-15", "15/01/2026", "2025-02-01T00:00:00.000Z", "2026-02-01"]],
      existing: [existing()],
    });
    assert.equal(ok.rows[0]?.after?.registration_issued_at, "2025-01-15T00:00:00+03:00");
    assert.equal(ok.rows[0]?.after?.registration_expires_at, "2026-01-15T00:00:00+03:00");
    assert.equal(ok.rows[0]?.after?.insurance_issued_at, "2025-02-01T00:00:00+03:00");
    assert.equal(ok.rows[0]?.after?.insurance_expires_at, "2026-02-01T00:00:00+03:00");

    const bad = previewVehicleImport({
      headers: ["Vehicle ID", "Insurance issued", "Insurance expiry"],
      rows: [["5/6767", "2026-01-01", "2025-01-01"]],
      existing: [existing()],
    });
    assert.equal(bad.rows[0]?.error, "expiry_before_issue");

    const invalid = previewVehicleImport({
      headers: ["Vehicle ID", "Registration expiry"],
      rows: [["5/6767", "soon"]],
      existing: [existing()],
    });
    assert.equal(invalid.rows[0]?.error, "invalid_document_date");
  });

  it("clears a stored document date with a dash", () => {
    const result = previewVehicleImport({
      headers: ["Vehicle ID", "Registration expiry"],
      rows: [["5/6767", "-"]],
      existing: [existing({ registration_expires_at: "2026-01-15T00:00:00+03:00" })],
    });
    assert.equal(result.rows[0]?.after?.registration_expires_at, null);
    assert.deepEqual(result.rows[0]?.clearedFields, ["registrationExpiresAt"]);
  });

  it("resolves the replacement plate and rejects an unknown one", () => {
    const ok = previewVehicleImport({
      headers: ["Vehicle ID", "Rep. Plate", "Since"],
      rows: [["9/1001", "5/6767", "2025-09-01"]],
      existing: [existing()],
    });
    assert.equal(ok.rows[0]?.after?.replaces_vehicle_id, "veh-1");
    assert.equal(ok.rows[0]?.after?.replacement_started_at, "2025-09-01T00:00:00+03:00");

    const bad = previewVehicleImport({
      headers: ["Vehicle ID", "Rep. Plate"],
      rows: [["9/1001", "0/0000"]],
      existing: [existing()],
    });
    assert.equal(bad.rows[0]?.error, "unknown_replacement");
  });

  it("refuses a vehicle that replaces itself", () => {
    const result = previewVehicleImport({
      headers: ["Vehicle ID", "Rep. Plate"],
      rows: [["5/6767", "5/6767"]],
      existing: [existing()],
    });
    assert.equal(result.rows[0]?.error, "invalid_replacement");
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
