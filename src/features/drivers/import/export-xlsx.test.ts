import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCredentialsAoa, buildImportErrorAoa } from "./export-xlsx";
import type { DriverImportCredential } from "../types";

describe("buildImportErrorAoa", () => {
  it("includes preview invalid rows and apply failures", () => {
    const aoa = buildImportErrorAoa(
      ["Full Name", "Phone"],
      [
        ["Ahmed", "99123456"],
        ["Sara", "99223456"],
      ],
      [
        { rowIndex: 0, status: "ok" },
        { rowIndex: 1, status: "duplicate_phone" },
      ],
      [{ rowIndex: 0, reason: "save_failed" }],
    );
    assert.equal(aoa.length, 3);
    assert.deepEqual(aoa[1], [1, "apply_failed", "save_failed", "Ahmed", "99123456"]);
    assert.deepEqual(aoa[2], [2, "duplicate_phone", "", "Sara", "99223456"]);
  });
});

function credential(
  overrides: Partial<DriverImportCredential> = {},
): DriverImportCredential {
  return {
    rowIndex: 0,
    full_name: "Ahmed Ali",
    employee_id: "12345",
    driver_code: "10001",
    passcode: "654321",
    phone: "+96599123456",
    civil_id: "281010100001",
    partner_name: "Talabat",
    zone_name: "Hawalli",
    vehicle_label: "BIKE-1024",
    restaurant_names: ["Crystal Tower"],
    nationality: "IN",
    rider_category: "in_house",
    client_id: "CLI-204",
    client_name: "Gulf Retail Group",
    custom_fields: {},
    ...overrides,
  };
}

describe("buildCredentialsAoa", () => {
  it("writes the saved driver, not only the login triple", () => {
    const aoa = buildCredentialsAoa([credential()]);
    assert.deepEqual(aoa[0], [
      "Full Name",
      "Employee ID",
      "Driver Code",
      "Passcode",
      "Phone",
      "Civil ID",
      "Partner",
      "Zone",
      "Vehicle",
      "Restaurants",
      "Nationality",
      "Rider Category",
      "Client ID",
      "Client Name",
    ]);
    assert.deepEqual(aoa[1], [
      "Ahmed Ali",
      "12345",
      "10001",
      "654321",
      "+96599123456",
      "281010100001",
      "Talabat",
      "Hawalli",
      "BIKE-1024",
      "Crystal Tower",
      "IN",
      "in_house",
      "CLI-204",
      "Gulf Retail Group",
    ]);
  });

  it("leaves optional cells blank rather than writing null", () => {
    const aoa = buildCredentialsAoa([
      credential({
        phone: null,
        civil_id: null,
        partner_name: null,
        zone_name: null,
        vehicle_label: null,
        restaurant_names: [],
        nationality: null,
        client_id: null,
        client_name: null,
      }),
    ]);
    assert.deepEqual(aoa[1]?.slice(4, 11), ["", "", "", "", "", "", ""]);
    assert.deepEqual(aoa[1]?.slice(12), ["", ""]);
  });

  it("adds custom-field columns, labelled when the picker knows them", () => {
    const aoa = buildCredentialsAoa(
      [
        credential({ custom_fields: { shirt_size: "m", notes: "night" } }),
        credential({
          rowIndex: 1,
          employee_id: "12346",
          custom_fields: { shirt_size: "s" },
        }),
      ],
      [{ key: "shirt_size", label: "Shirt size" }],
    );
    assert.equal(aoa[0]?.at(-2), "notes");
    assert.equal(aoa[0]?.at(-1), "Shirt size");
    assert.equal(aoa[1]?.at(-2), "night");
    assert.equal(aoa[1]?.at(-1), "m");
    assert.equal(aoa[2]?.at(-2), "");
    assert.equal(aoa[2]?.at(-1), "s");
  });
});
