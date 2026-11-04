import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  previewBaselineImport,
  splitMakeModel,
  normalisePlate,
  parseKm,
  parseSheetDate,
  type BaselineFleetVehicle,
} from "./service-baseline-import";
import { approvedRulesAsSchedules } from "./service-programs";

/**
 * The client's car sheet, applied twice.
 *
 * Two promises rest on this preview: the nine plates the fleet does not hold are
 * **created** (they are real cars with real history, not typos), and nothing is
 * ever created twice — every row is matched on plate *and* on chassis against the
 * whole fleet before a single document is written.
 */

const RULES = approvedRulesAsSchedules();

const HEADER = [
  "Plate number",
  "Chassis Number",
  "Model",
  "Current KM",
  "last service",
  "last service Date",
  "Next Km",
];

const FLEET: BaselineFleetVehicle[] = [
  {
    id: "v-yaris",
    plate: "23/21208",
    chassisNo: "MR0AB8CD800123456",
    make: "Toyota",
    model: "Yaris",
    vehicleTypeKey: "car",
    condition: "running",
    zoneName: null,
    driverName: null,
    currentKm: 74000,
  },
  {
    id: "v-hyundai",
    plate: "22/21543",
    chassisNo: "KMHXX00XXXX000001",
    make: "Hyundai",
    model: "Half Lorry",
    vehicleTypeKey: "car",
    condition: "running",
    zoneName: null,
    driverName: null,
    currentKm: 444000,
  },
];

function sheet(...rows: (string | number)[][]) {
  return [HEADER, ...rows];
}

describe("sheet helpers", () => {
  it("normalises a plate without losing the slash", () => {
    assert.equal(normalisePlate(" 23/21208 "), "23/21208");
    assert.equal(normalisePlate("23 / 21208"), "23/21208");
  });

  it("reads a kilometre figure with separators or a unit suffix", () => {
    assert.equal(parseKm("74,721"), 74721);
    assert.equal(parseKm("74721 km"), 74721);
    assert.equal(parseKm(74721), 74721);
    assert.equal(parseKm(""), null);
    assert.equal(parseKm("not a number"), null);
  });

  it("reads the three date shapes the sheet uses", () => {
    assert.equal(parseSheetDate("18/10/2026"), "2026-10-18");
    assert.equal(parseSheetDate("2026-10-18"), "2026-10-18");
    assert.equal(parseSheetDate("18-10-2026"), "2026-10-18");
  });

  it("splits a model on the first slash or dash", () => {
    assert.deepEqual(splitMakeModel("Toyota/Yaris"), { make: "Toyota", model: "Yaris" });
    assert.deepEqual(splitMakeModel("Hyundai/Half Lorry"), {
      make: "Hyundai",
      model: "Half Lorry",
    });
    assert.deepEqual(splitMakeModel("Changan - Alsvin"), { make: "Changan", model: "Alsvin" });
    // No separator: the whole string is the model, and the make stays null
    // rather than being guessed.
    assert.deepEqual(splitMakeModel("Alsvin"), { make: null, model: "Alsvin" });
  });

describe("baseline import preview", () => {
  it("matches an existing vehicle by plate and checks the sheet's Next Km", () => {
    const preview = previewBaselineImport(
      sheet(["23/21208", "MR0AB8CD800123456", "Toyota/Yaris", 74721, 70000, "18/10/2026", 80000]),
      FLEET,
      RULES,
    );
    assert.equal(preview.counts.plate, 1);
    assert.equal(preview.counts.create, 0);
    const item = preview.items[0];
    assert.equal(item?.group, "plate");
    assert.equal(item?.vehicleId, "v-yaris");
    assert.equal(item?.kmInterval, 10000);
    assert.equal(item?.expectedNextKm, 80000);
    assert.equal(item?.nextKmDisagrees, false);
    assert.equal(preview.nextKmMismatches, 0);
  });

  it("matches by chassis when the plate in the sheet differs", () => {
    const preview = previewBaselineImport(
      sheet(["NEW-PLATE", "MR0AB8CD800123456", "Toyota/Yaris", 74721, 70000, "18/10/2026", 80000]),
      FLEET,
      RULES,
    );
    const item = preview.items[0];
    assert.equal(item?.group, "chassis");
    assert.equal(item?.vehicleId, "v-yaris");
    // The fleet's own plate is reported, never rewritten from a spreadsheet.
    assert.equal(item?.matchedPlate, "23/21208");
    assert.equal(item?.notes.some((note) => note.startsWith("plate_in_fleet_is_")), true);
  });

  it("creates a car when neither plate nor chassis matches", () => {
    const preview = previewBaselineImport(
      sheet([
        "21/98175",
        "JTDBR32E600123789",
        "Changan - Alsvin",
        12000,
        10000,
        "01/02/2026",
        20000,
      ]),
      FLEET,
      RULES,
    );
    const item = preview.items[0];
    assert.equal(item?.group, "create");
    assert.equal(item?.vehicleId, null);
    assert.equal(item?.make, "Changan");
    assert.equal(item?.model, "Alsvin");
    assert.equal(item?.plate, "21/98175");
    assert.equal(item?.chassisNo, "JTDBR32E600123789");
    assert.equal(preview.counts.create, 1);
  });

  it("rejects a duplicate plate inside the file, keeping the first row", () => {
    const preview = previewBaselineImport(
      sheet(
        ["21/98175", "CHASSIS-A", "Changan - Alsvin", 12000, 10000, "01/02/2026", 20000],
        ["21/98175", "CHASSIS-B", "Changan - Alsvin", 12000, 10000, "01/02/2026", 20000],
      ),
      FLEET,
      RULES,
    );
    assert.equal(preview.items[0]?.group, "create");
    assert.equal(preview.items[1]?.group, "reject");
    assert.equal(
      preview.items[1]?.notes.some((note) => note.startsWith("duplicate_plate_of_row_")),
      true,
    );
    assert.equal(preview.counts.create, 1);
    assert.equal(preview.counts.reject, 1);
  });

  it("rejects a duplicate chassis inside the file", () => {
    const preview = previewBaselineImport(
      sheet(
        ["21/98175", "CHASSIS-A", "Changan - Alsvin", 12000, 10000, "01/02/2026", 20000],
        ["21/98460", "CHASSIS-A", "Changan - Alsvin", 12000, 10000, "01/02/2026", 20000],
      ),
      FLEET,
      RULES,
    );
    assert.equal(preview.items[1]?.group, "reject");
    assert.equal(
      preview.items[1]?.notes.some((note) => note.startsWith("duplicate_chassis_of_row_")),
      true,
    );
  });

  it("rejects a row with no plate", () => {
    const preview = previewBaselineImport(
      sheet(["", "CHASSIS-C", "Toyota/Yaris", 100, 50, "01/02/2026", 100]),
      FLEET,
      RULES,
    );
    assert.equal(preview.items[0]?.group, "reject");
    assert.deepEqual(preview.items[0]?.notes, ["missing_plate"]);
  });
});


describe("baseline import preview, remaining cases", () => {
  it("flags a Next Km that disagrees with the approved interval", () => {
    const preview = previewBaselineImport(
      // Hyundai oil is 5,000 km, so 70,000 should read 75,000 — not 80,000.
      sheet([
        "22/21543",
        "KMHXX00XXXX000001",
        "Hyundai/Half Lorry",
        445000,
        70000,
        "18/10/2026",
        80000,
      ]),
      FLEET,
      RULES,
    );
    const item = preview.items[0];
    assert.equal(item?.kmInterval, 5000);
    assert.equal(item?.expectedNextKm, 75000);
    assert.equal(item?.nextKmDisagrees, true);
    assert.equal(preview.nextKmMismatches, 1);
  });

  it("creates nothing on a second pass of the same sheet", () => {
    const rows = sheet(
      ["21/98175", "JTDBR32E600123789", "Changan - Alsvin", 12000, 10000, "01/02/2026", 20000],
      ["23/21208", "MR0AB8CD800123456", "Toyota/Yaris", 74721, 70000, "18/10/2026", 80000],
    );
    const first = previewBaselineImport(rows, FLEET, RULES);
    assert.equal(first.counts.create, 1);
    assert.equal(first.counts.plate, 1);

    // The apply step writes each created car back as a fleet row, so the same
    // sheet must find it the second time.
    const afterApply: BaselineFleetVehicle[] = [
      ...FLEET,
      {
        id: "v-changan",
        plate: "21/98175",
        chassisNo: "JTDBR32E600123789",
        make: "Changan",
        model: "Alsvin",
        vehicleTypeKey: "car",
        condition: "running",
        zoneName: null,
        driverName: null,
        currentKm: 12000,
      },
    ];
    const second = previewBaselineImport(rows, afterApply, RULES);
    assert.equal(second.counts.create, 0);
    assert.equal(second.counts.plate, 2);
  });

  it("finds a car by chassis after its plate changed", () => {
    const rows = sheet([
      "99/99999",
      "MR0AB8CD800123456",
      "Toyota/Yaris",
      74721,
      70000,
      "18/10/2026",
      80000,
    ]);
    const preview = previewBaselineImport(rows, FLEET, RULES);
    assert.equal(preview.items[0]?.group, "chassis");
    assert.equal(preview.counts.create, 0);
  });

  it("blocks the odometer write when Current KM is below the last service figure", () => {
    // The real sheet has 38 of these: e.g. 22/21543 at 500 km with a service at
    // 1,001,142 km, and 12/53620 at 424,424 km with a service at 445,000 km. One
    // of the two figures is wrong, so nothing may rewind the meter.
    const preview = previewBaselineImport(
      sheet(["22/21543", "CHASSIS-X", "Changan - Alsvin", 500, 1001142, "03/06/2026", 2000000]),
      FLEET,
      RULES,
    );
    const item = preview.items[0];
    // The row is still imported as a matched vehicle with real history…
    assert.equal(item?.group, "plate");
    assert.equal(item?.vehicleId, "v-hyundai");
    assert.equal(item?.odometerBlocked, true);
    // …but its odometer write is withheld, and the reason is on the row.
    assert.equal(
      item?.notes.some((note) => note.startsWith("current_km_below_last_service_")),
      true,
    );
    assert.equal(preview.kmBelowService, 1);
    assert.equal(preview.counts.reject, 0);
  });

  it("allows a row where Current KM equals the last service figure", () => {
    const preview = previewBaselineImport(
      sheet(["23/21208", "MR0AB8CD800123456", "Toyota/Yaris", 70000, 70000, "18/10/2026", 80000]),
      FLEET,
      RULES,
    );
    assert.equal(preview.items[0]?.group, "plate");
    assert.equal(preview.kmBelowService, 0);
    assert.equal(preview.items[0]?.nextKmDisagrees, false);
  });

  it("reads the sheet's 0 as 'no reading', not as a 0 km service", () => {
    // `last service` 0 with `Next Km` 0 is how this sheet says "never serviced".
    // Reading the zeros literally made 13 rows look like disagreement.
    const preview = previewBaselineImport(
      sheet(["23/21208", "MR0AB8CD800123456", "Toyota/Yaris", 74721, 0, "", 0]),
      FLEET,
      RULES,
    );
    const item = preview.items[0];
    assert.equal(item?.lastServiceKm, null);
    assert.equal(item?.nextKm, null);
    assert.equal(item?.expectedNextKm, null);
    assert.equal(item?.nextKmDisagrees, false);
    assert.equal(preview.nextKmMismatches, 0);
  });

  it("reads the client's real column order, Next Km before last service", () => {
    // The client's own header, in the client's own order, with the extra
    // `Replacment Car` column the importer ignores.
    const rows = [
      [
        "plate number",
        "Chassis Number",
        "Model",
        "Current KM",
        "Next Km",
        "last service",
        "last service Date",
        "Replacment Car",
      ],
      ["23/21208", "MR0AB8CD800123456", "Toyota/Yaris", 74721, 80000, 70000, "18/10/2026", ""],
    ];
    const preview = previewBaselineImport(rows, FLEET, RULES);
    const item = preview.items[0];
    assert.equal(item?.group, "plate");
    assert.equal(item?.currentKm, 74721);
    assert.equal(item?.nextKm, 80000);
    assert.equal(item?.lastServiceKm, 70000);
    assert.equal(item?.lastServiceDay, "2026-10-18");
    assert.equal(item?.nextKmDisagrees, false);
  });

  it("reads the client's own column names", () => {
    const preview = previewBaselineImport(
      sheet(["23/21208", "MR0AB8CD800123456", "Toyota/Yaris", 74721, 70000, "18/10/2026", 80000]),
      FLEET,
      RULES,
    );
    assert.equal(preview.headerRow, 0);
    assert.equal(preview.items[0]?.currentKm, 74721);
    assert.equal(preview.items[0]?.lastServiceKm, 70000);
    assert.equal(preview.items[0]?.lastServiceDay, "2026-10-18");
    assert.equal(preview.items[0]?.nextKm, 80000);
  });
});

});
