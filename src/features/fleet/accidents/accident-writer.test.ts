import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { accidentWritePayload, type AccidentVehicleSnapshot } from "./accident-model";
import type { AccidentInput } from "./accident-types";

/**
 * The singleton guarantee, stated as a test.
 *
 * There must be exactly one function that turns an accident input into a stored
 * document. `accidentWritePayload` (in `accident-model.ts`) is it: the new
 * `createAccident` action and the legacy `createVehicleAccident` entry point both
 * call it, and neither builds a field list of its own. A second writer added
 * later fails this file instead of quietly producing a thinner document.
 */

const SRC = join(process.cwd(), "src");
/**
 * Markers that only a write payload can carry. A type declaration writes
 * `case_status:` too, so each marker includes the builder's own expression.
 */
const WRITE_MARKERS = [
  "case_status: options.caseStatus",
  "vehicle_case_status: isVehicleCaseStatus(",
  "driver_fault: isDriverFault(",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function read(relativePath: string): string {
  return readFileSync(join(SRC, relativePath), "utf8");
}

const files = sourceFiles(SRC).filter((file) => !/\.test\.tsx?$/.test(file));

describe("accident writer singleton", () => {
  it("has exactly one module that builds the stored field list", () => {
    const builders = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return WRITE_MARKERS.every((marker) => text.includes(marker));
    });
    assert.deepEqual(
      builders.map((file) => relative(SRC, file).replace(/\\/g, "/")),
      ["features/fleet/accidents/accident-model.ts"],
    );
  });

  it("no longer writes the collection from the vehicle detail module", () => {
    const text = read("features/vehicles/vehicle-tabs-actions.ts");
    assert.equal(text.includes("insertRow(ACCIDENTS"), false);
    // It delegates to the one writer instead.
    assert.equal(text.includes("createAccident("), true);
  });

  it("the create action calls the shared payload builder", () => {
    const text = read("features/fleet/accidents/accident-actions.ts");
    assert.equal(text.includes("accidentWritePayload("), true);
    assert.equal(text.includes("export async function createAccident("), true);
    // Identity and provenance are written by the builder, not by the action.
    assert.equal(text.includes("plate_snapshot:"), false);
    assert.equal(text.includes("driver_fault:"), false);
  });
});

const INPUT: AccidentInput = {
  vehicleId: "veh-1",
  occurredAt: "2026-11-01T18:30",
  locationText: "Ring Road",
  locationLat: 29.3,
  locationLng: 47.9,
  driverFault: "yes",
  caseStatus: "pending",
  vehicleCaseStatus: "case_check",
  insuranceCompany: "Gulf Insurance",
  insuranceClaimStatus: "submitted",
  policeReportStatus: "filed",
  amountKwd: 120.5,
  otherPartyName: "Ahmed",
  otherPartyPlate: "12345",
  otherPartyPhone: "+965 9000 1234",
  description: "Rear bumper.",
  fleetComment: "",
  replacementPlate: "",
  severity: "",
  notes: "",
  attachmentKeys: ["vehicles/veh-1/accidents/a.jpg"],
};

const SNAPSHOT: AccidentVehicleSnapshot = {
  plate: "8421",
  company_name: "Americana",
  model_year: 2023,
  driver_id: "drv-1",
  driver_name: "Sam Test",
  driver_code: "D-1",
  employee_id: "10043",
};

const OPTIONS = {
  reference: "ACC-0001",
  attachments: [],
  source: "admin" as const,
  reportedBy: "staff-1",
  reportedByName: "Operator",
  caseStatus: "pending" as const,
  vehicleCaseStatus: "case_check",
  now: new Date("2026-11-02T10:00:00.000Z"),
};

describe("one payload, two entry points", () => {
  it("the same input produces a byte-identical document", () => {
    const first = accidentWritePayload(INPUT, SNAPSHOT, OPTIONS);
    const second = accidentWritePayload(INPUT, SNAPSHOT, OPTIONS);
    assert.deepEqual(first, second);
    // Same instant, same reference: no clock or counter drift between the paths.
    assert.equal(
      (first.occurred_at as Date).getTime(),
      (second.occurred_at as Date).getTime(),
    );
  });

  it("a different input produces a different document", () => {
    const first = accidentWritePayload(INPUT, SNAPSHOT, OPTIONS);
    const second = accidentWritePayload(
      { ...INPUT, locationText: "Salmiya, Block 10" },
      SNAPSHOT,
      OPTIONS,
    );
    assert.notDeepEqual(first, second);
    assert.equal(second.location_text, "Salmiya, Block 10");
    // The case is chosen by the caller (the form / the callable), not by the input.
    const delayed = accidentWritePayload(INPUT, SNAPSHOT, { ...OPTIONS, caseStatus: "delay" });
    assert.equal(delayed.case_status, "delay");
  });

  it("a rider-sourced report carries the rider provenance it is given", () => {
    const payload = accidentWritePayload(INPUT, SNAPSHOT, {
      ...OPTIONS,
      source: "rider",
      reportedBy: "9JfM0181bxQBjaZRuBhL58Tb4Gy1",
      reportedByName: "Sam Test",
    });
    assert.equal(payload.source, "rider");
    assert.equal(payload.reported_by, "9JfM0181bxQBjaZRuBhL58Tb4Gy1");
    assert.equal(payload.reviewed_at, null);
  });
});
