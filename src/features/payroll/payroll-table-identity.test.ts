import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PAYROLL_IDENTITY_SEQUENCE,
  PAYROLL_IDENTITY_WIDTH,
  identityCount,
  identityOffsetAt,
  identityOffsets,
  identityRank,
  identityWidth,
  orderIdentityColumns,
  withSerialColumn,
} from "./payroll-table-identity";

const SUMMARY = [
  { id: "amId" },
  { id: "mgId" },
  { id: "name" },
  { id: "restaurant" },
  { id: "zone" },
  { id: "status" },
  { id: "totalDays" },
];

describe("payroll table identity", () => {
  it("leads with # / MG ID / Client ID / Employee Name and keeps the rest in order", () => {
    const ordered = orderIdentityColumns(SUMMARY).map((column) => column.id);
    assert.deepEqual(ordered, [
      "amId",
      "mgId",
      "name",
      "restaurant",
      "zone",
      "status",
      "totalDays",
    ]);
  });

  it("is a stable hoist: a second pass changes nothing", () => {
    const once = orderIdentityColumns(SUMMARY);
    const twice = orderIdentityColumns(once);
    assert.deepEqual(
      twice.map((column) => column.id),
      once.map((column) => column.id),
    );
  });

  it("puts the serial first when a sheet asks for one", () => {
    const withSerial = withSerialColumn(SUMMARY, { id: "serial" });
    assert.equal(withSerial[0].id, "serial");
    assert.deepEqual(
      withSerial.slice(1, 4).map((column) => column.id),
      ["amId", "mgId", "name"],
    );
    // Nothing is dropped and nothing is added twice.
    assert.equal(withSerial.length, SUMMARY.length + 1);
  });

  it("reads the alias keys the older catalogues use", () => {
    assert.equal(identityRank("serial"), PAYROLL_IDENTITY_SEQUENCE.indexOf("serial"));
    assert.equal(identityRank("i"), PAYROLL_IDENTITY_SEQUENCE.indexOf("serial"));
    // `amId` / `mg` print MG ID; `mgId` / `client` print Client ID.
    assert.equal(identityRank("amId"), 1);
    assert.equal(identityRank("mg"), 1);
    assert.equal(identityRank("mgId"), 2);
    assert.equal(identityRank("client"), 2);
    assert.equal(identityRank("clientId"), 2);
    assert.equal(identityRank("name"), 3);
    assert.equal(identityRank("zone"), -1);
  });

  it("publishes one width per identity column and none for the rest", () => {
    assert.equal(identityWidth("serial"), PAYROLL_IDENTITY_WIDTH.serial);
    assert.equal(identityWidth("amId"), PAYROLL_IDENTITY_WIDTH.mgId);
    assert.equal(identityWidth("mgId"), PAYROLL_IDENTITY_WIDTH.clientId);
    assert.equal(identityWidth("name"), PAYROLL_IDENTITY_WIDTH.name);
    assert.equal(identityWidth("restaurant"), 0);
  });

  it("accumulates offsets so headers and cells can never disagree", () => {
    const columns = withSerialColumn(SUMMARY, { id: "serial" });
    const offsets = identityOffsets(columns);
    assert.equal(offsets[0], 0);
    assert.equal(offsets[1], PAYROLL_IDENTITY_WIDTH.serial);
    assert.equal(offsets[2], PAYROLL_IDENTITY_WIDTH.serial + PAYROLL_IDENTITY_WIDTH.mgId);
    assert.equal(
      offsets[3],
      PAYROLL_IDENTITY_WIDTH.serial + PAYROLL_IDENTITY_WIDTH.mgId + PAYROLL_IDENTITY_WIDTH.clientId,
    );
    assert.equal(offsets[4], -1);
    assert.equal(identityOffsetAt(columns, 4), 0);
    assert.equal(identityCount(columns), 4);
  });
});
