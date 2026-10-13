import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  catalogNameStamp,
  driverPrefixQueries,
  driverSearchStamp,
  prefixBounds,
  requestSearchStamp,
  tokenPrefixMatch,
} from "./search-text";

describe("prefix match", () => {
  it("bounds a lowercase prefix with the high sentinel", () => {
    assert.deepEqual(prefixBounds("  Jen "), { start: "jen", end: "jen\uf8ff" });
    assert.equal(prefixBounds("   "), null);
  });

  it("matches the start of the string or of a token", () => {
    assert.equal(tokenPrefixMatch("Jenson Doe", "jen"), true);
    assert.equal(tokenPrefixMatch("Zone Hawally", "hawally"), true);
    assert.equal(tokenPrefixMatch("(FRW)", "frw"), true);
    assert.equal(tokenPrefixMatch("merchant m-100", "m-100"), true);
    assert.equal(tokenPrefixMatch("Hawally", "ally"), false);
    assert.equal(tokenPrefixMatch("KFC Hawally", "fc"), false);
  });

  it("stamps stored lowercase fields and skips a phone-only identity blob", () => {
    const stamped = driverSearchStamp({
      fullName: "Jenson Doe",
      driverCode: "10088",
      employeeId: "108899",
      phone: "+965 5123 4567",
      clientName: "Careem",
    });
    assert.equal(stamped.name_lower, "jenson doe");
    assert.equal(stamped.driver_code_lower, "10088");
    assert.equal(stamped.employee_id_lower, "108899");
    assert.equal(stamped.phone_digits, "96551234567");
    assert.equal(stamped.search_name?.startsWith("jenson doe"), true);
    assert.deepEqual(driverSearchStamp({ phone: "5123" }), { phone_digits: "5123" });
  });

  it("stamps catalog and request names", () => {
    assert.equal(catalogNameStamp("KFC Hawally", "100").name_lower, "kfc hawally");
    assert.equal(catalogNameStamp("KFC Hawally", "100").merchant_id_lower, "100");
    assert.equal(requestSearchStamp({ requestCode: "RCM-0074", driverName: "Jenson" }).request_code_lower, "rcm-0074");
    assert.equal(driverPrefixQueries("Jen").some((query) => query.field === "name_lower"), true);
    assert.equal(driverPrefixQueries("5123").some((query) => query.field === "phone_digits"), true);
  });
});
