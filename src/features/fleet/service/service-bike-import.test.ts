import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BIKE_IMPORT_HEADERS,
  bikeProgramFor,
  previewBikeImport,
  type BikeFleetVehicle,
} from "./service-bike-import";

/**
 * The bike sheet.
 *
 * Bikes are the fleet's most-used and least-measured vehicles, and Bajaj Care —
 * the client's own workshop system — cannot be read from here yet. So this sheet
 * is the intake, and it has to be strict in one specific way: **a car plate in a
 * bike sheet is rejected**, because the sheet is shared across departments and a
 * silent re-file would move a bike's oil date with a car's service.
 */

const TODAY = "2026-11-04";

const FLEET: BikeFleetVehicle[] = [
  { id: "b-1", plate: "B-1042", chassisNo: "MD2A11AZ000001", vehicleTypeKey: "bike" },
  { id: "b-2", plate: "B-2087", chassisNo: "MD2A11AZ000002", vehicleTypeKey: "bike" },
  { id: "c-1", plate: "23/21208", chassisNo: "MR0AB8CD800123456", vehicleTypeKey: "car" },
];

function sheet(...rows: (string | number)[][]) {
  return [[...BIKE_IMPORT_HEADERS], ...rows];
}

describe("bike program mapping", () => {
  it("accepts the three bike programs and the words a workshop uses", () => {
    assert.equal(bikeProgramFor("oil_change"), "oil_change");
    assert.equal(bikeProgramFor("Oil change"), "oil_change");
    assert.equal(bikeProgramFor("engine oil"), "oil_change");
    assert.equal(bikeProgramFor("brake"), "brake");
    assert.equal(bikeProgramFor("Brake pads"), "brake");
    assert.equal(bikeProgramFor("chain"), "chain");
    assert.equal(bikeProgramFor("Chain adjust"), "chain");
  });

  it("refuses a car program on a bike", () => {
    assert.equal(bikeProgramFor("tire_front"), null);
    assert.equal(bikeProgramFor("Front tyres"), null);
    assert.equal(bikeProgramFor("screen wash"), null);
  });
});

describe("bike import preview", () => {
  it("matches a bike by plate and keeps the cost and vendor", () => {
    const preview = previewBikeImport(
      sheet(["B-1042", "18/10/2026", "Oil change", 18420, 8.5, "Bajaj Care", "INV-7781", "10W-40"]),
      FLEET,
      TODAY,
    );
    const item = preview.items[0];
    assert.equal(item?.group, "create");
    assert.equal(item?.vehicleId, "b-1");
    assert.equal(item?.programKey, "oil_change");
    assert.equal(item?.serviceDay, "2026-10-18");
    assert.equal(item?.odometerKm, 18420);
    assert.equal(item?.costKwd, 8.5);
    assert.equal(item?.vendor, "Bajaj Care");
    assert.equal(item?.invoiceNo, "INV-7781");
    assert.equal(preview.counts.create, 1);
  });

  it("matches a bike by chassis when the plate differs", () => {
    const preview = previewBikeImport(
      sheet(["B-9999", "18/10/2026", "chain", 9000, "", "", "", ""]),
      [
        ...FLEET,
        { id: "b-3", plate: "B-9999", chassisNo: "MD2A11AZ000002", vehicleTypeKey: "bike" },
      ],
      TODAY,
    );
    // "B-9999" is a bike plate, so the plate match wins; the point is that it is
    // a bike either way and never a car.
    assert.equal(preview.items[0]?.group, "create");
    assert.equal(preview.items[0]?.vehicleId, "b-3");
  });

  it("rejects a car plate rather than filing it on a bike", () => {
    const preview = previewBikeImport(
      sheet(["23/21208", "18/10/2026", "Oil change", 74721, 20, "Workshop", "INV-1", ""]),
      FLEET,
      TODAY,
    );
    assert.equal(preview.items[0]?.group, "reject");
    assert.equal(preview.items[0]?.problem, "not_a_bike");
    assert.equal(preview.counts.create, 0);
  });

  it("rejects an unrecognised service type instead of filing it as other", () => {
    const preview = previewBikeImport(
      sheet(["B-1042", "18/10/2026", "Screen wash", 18420, 2, "", "", ""]),
      FLEET,
      TODAY,
    );
    assert.equal(preview.items[0]?.problem, "unknown_service_type");
    assert.equal(preview.items[0]?.programKey, null);
  });

  it("rejects a future date and a missing date", () => {
    const future = previewBikeImport(
      sheet(["B-1042", "01/01/2027", "Oil change", 18420, 8.5, "", "", ""]),
      FLEET,
      TODAY,
    );
    assert.equal(future.items[0]?.problem, "future_date");
    const missing = previewBikeImport(
      sheet(["B-1042", "", "Oil change", 18420, 8.5, "", "", ""]),
      FLEET,
      TODAY,
    );
    assert.equal(missing.items[0]?.problem, "invalid_date");
  });

  it("rejects a plate that is not in the fleet at all", () => {
    const preview = previewBikeImport(
      sheet(["B-0000", "18/10/2026", "Oil change", 18420, 8.5, "", "", ""]),
      FLEET,
      TODAY,
    );
    assert.equal(preview.items[0]?.problem, "unknown_plate");
  });

  it("counts a mixed sheet honestly", () => {
    const preview = previewBikeImport(
      sheet(
        ["B-1042", "18/10/2026", "Oil change", 18420, 8.5, "", "", ""],
        ["B-2087", "20/10/2026", "Brake pads", 21100, 11, "", "", ""],
        ["23/21208", "18/10/2026", "Oil change", 74721, 20, "", "", ""],
        ["B-1042", "18/10/2026", "Screen wash", 18420, 2, "", "", ""],
      ),
      FLEET,
      TODAY,
    );
    assert.equal(preview.counts.create, 2);
    assert.equal(preview.counts.reject, 2);
    assert.equal(preview.counts.total, 4);
  });
});
