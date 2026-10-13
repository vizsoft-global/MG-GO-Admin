import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultAttachmentTitle,
  ledgerEntry,
  missingAttachmentKind,
  validateFuelFill,
} from "./driver-vehicle";

function attachment(kind: string, extra: Record<string, unknown> = {}) {
  return {
    kind,
    storage_key: `drivers/r1/${kind}.jpg`,
    captured_at: "2026-10-09T18:00:00+03:00",
    ...extra,
  };
}

describe("driver-vehicle helpers", () => {
  it("names the three required fuel kinds", () => {
    assert.equal(defaultAttachmentTitle("fuel_receipt"), "Fuel receipt");
    assert.equal(defaultAttachmentTitle("fuel_pump"), "Fuel pump");
    assert.equal(defaultAttachmentTitle("odometer"), "Odometer reading");
    assert.equal(missingAttachmentKind(["fuel_receipt", "fuel_pump"]), "odometer");
    assert.equal(missingAttachmentKind(["fuel_receipt", "fuel_pump", "odometer"]), null);
  });

  it("returns ledger rows without storage keys", () => {
    const row = ledgerEntry({
      at: "2026-10-01T10:00:00+03:00",
      notes: "  cracked mirror  ",
      kind: "medium",
      hasFile: true,
    });
    assert.deepEqual(row, {
      at: "2026-10-01",
      notes: "cracked mirror",
      kind: "medium",
      has_file: true,
    });
    assert.equal("storage_key" in row, false);
    assert.equal("read_url" in row, false);
  });

  it("refuses a fuel fill that is missing litres, cost, station or GPS", () => {
    const base = {
      litres: 12,
      costKwd: 3.5,
      stationName: "Al Soor",
      lat: 29.37,
      lng: 47.97,
      attachments: [
        attachment("fuel_receipt"),
        attachment("fuel_pump"),
        attachment("odometer"),
      ],
    };
    assert.equal(validateFuelFill({ ...base, litres: 0 }).ok, false);
    const litres = validateFuelFill({ ...base, litres: null });
    const cost = validateFuelFill({ ...base, costKwd: -1 });
    const station = validateFuelFill({ ...base, stationName: null });
    const gps = validateFuelFill({ ...base, lat: null });
    assert.equal(litres.ok, false);
    assert.equal(cost.ok, false);
    assert.equal(station.ok, false);
    assert.equal(gps.ok, false);
    if (!litres.ok) assert.equal(litres.error, "litres_required");
    if (!cost.ok) assert.equal(cost.error, "cost_required");
    if (!station.ok) assert.equal(station.error, "station_required");
    if (!gps.ok) assert.equal(gps.error, "location_required");
  });

  it("names the missing attachment kind", () => {
    const result = validateFuelFill({
      litres: 8,
      costKwd: 2,
      stationName: "Al Rai",
      lat: 29.3,
      lng: 47.9,
      attachments: [attachment("fuel_receipt"), attachment("fuel_pump")],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "attachment_required");
      assert.equal(result.missing_kind, "odometer");
    }
  });

  it("accepts a complete fill", () => {
    const result = validateFuelFill({
      litres: 8,
      costKwd: 0,
      stationName: "Al Rai",
      lat: 29.3,
      lng: 47.9,
      attachments: [
        attachment("fuel_receipt"),
        attachment("fuel_pump"),
        attachment("odometer"),
      ],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.litres, 8);
      assert.equal(result.costKwd, 0);
    }
  });
});
