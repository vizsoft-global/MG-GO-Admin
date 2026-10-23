import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHrImport } from "./hr-payroll-import";

const roster = [
  { driverId: "a", mgId: "10001", driverCode: "90001" },
  { driverId: "b", mgId: "10002", driverCode: "90002" },
  { driverId: "c", mgId: "10003", driverCode: "90001" },
];

describe("parseHrImport", () => {
  it("matches MG ID first, then a unique driver code", () => {
    const result = parseHrImport("MG ID,amount\n10001,1.5\n90002,2", roster, "pendingSalary");
    assert.deepEqual(
      result.matched.map((row) => [row.driverId, row.amount]),
      [
        ["a", 1.5],
        ["b", 2],
      ],
    );
    assert.deepEqual(result.unknown, []);
    assert.deepEqual(result.ambiguous, []);
  });

  it("lists unknown and ambiguous ids and skips a negative amount", () => {
    const result = parseHrImport("99999,4\n90001,3\n10002,-1", roster, "loanDeduction");
    assert.deepEqual(result.matched, []);
    assert.deepEqual(result.unknown, ["99999", "10002"]);
    assert.deepEqual(result.ambiguous, ["90001"]);
  });
});
