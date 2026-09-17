import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterChassis,
  filterChip,
  filterFuelLimit,
  filterLocation,
  filterMakeModel,
  filterPlate,
  filterVehicleId,
  filterYear,
  validateVehicleForm,
} from "./vehicle-form-validation";

const valid = {
  bikeId: "Test01",
  regNumber: "5/6767",
  chassisNo: "MD2A16CY0PWH12345",
  make: "Bajaj Pulsar",
  model: "Bajaj Pulsar",
  locationText: "Hawally",
  modelYear: "2024",
  chipNo: "123",
  fuelMonthlyLimitKwd: "30",
};

describe("vehicle form filters", () => {
  it("strips illegal Vehicle ID chars and caps length", () => {
    assert.equal(filterVehicleId("Test 01!"), "Test01");
    assert.equal(filterVehicleId("A".repeat(40)).length, 32);
  });

  it("keeps Kuwait plate digits/slash only", () => {
    assert.equal(filterPlate("5/6767"), "5/6767");
    assert.equal(filterPlate("22/21543abc"), "22/21543");
    assert.equal(filterPlate("KWT-88"), "88");
    assert.equal(validateVehicleForm({ ...valid, regNumber: "88" }), "invalid_plate");
  });

  it("keeps chassis alnum to 17", () => {
    assert.equal(filterChassis("md2-a16"), "md2a16");
    assert.equal(filterChassis("X".repeat(20)).length, 17);
  });

  it("keeps make/model letters and fuel decimals", () => {
    assert.equal(filterMakeModel("Bajaj Pulsar!!!"), "Bajaj Pulsar");
    assert.equal(filterLocation("Ardiya, Block 1 #"), "Ardiya, Block 1 ");
    assert.equal(filterYear("20ab24"), "2024");
    assert.equal(filterChip("12#3"), "123");
    assert.equal(filterFuelLimit("12.3456"), "12.345");
    assert.equal(filterFuelLimit("....,,,,----"), "");
  });
});

describe("validateVehicleForm", () => {
  it("accepts the live fleet sample", () => {
    assert.equal(validateVehicleForm(valid), null);
  });

  it("requires Vehicle ID and rejects junk identity", () => {
    assert.equal(validateVehicleForm({ ...valid, bikeId: "" }), "missing_fields");
    assert.equal(validateVehicleForm({ ...valid, bikeId: "***" }), "invalid_vehicle_id");
    assert.equal(validateVehicleForm({ ...valid, regNumber: "abc" }), "invalid_plate");
    assert.equal(validateVehicleForm({ ...valid, chassisNo: "short" }), "invalid_chassis");
    assert.equal(validateVehicleForm({ ...valid, make: "!!!" }), "invalid_make");
    assert.equal(validateVehicleForm({ ...valid, modelYear: "1989" }), "invalid_year");
    assert.equal(validateVehicleForm({ ...valid, modelYear: "abcd" }), "invalid_year");
    assert.equal(validateVehicleForm({ ...valid, chipNo: "??" }), "invalid_chip");
    assert.equal(validateVehicleForm({ ...valid, fuelMonthlyLimitKwd: "abc" }), "invalid_fuel_limit");
    assert.equal(validateVehicleForm({ ...valid, fuelMonthlyLimitKwd: "0" }), "invalid_fuel_limit");
  });

  it("allows empty optional fields", () => {
    assert.equal(
      validateVehicleForm({
        bikeId: "Test1",
        regNumber: "",
        chassisNo: "",
        make: "",
        model: "",
        locationText: "",
        modelYear: "",
        chipNo: "",
        fuelMonthlyLimitKwd: "",
      }),
      null,
    );
  });
});
