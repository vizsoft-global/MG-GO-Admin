import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ImportLookupMatch } from "@/features/drivers/resolve-import-row";
import {
  decideGroupImportRow,
  groupImportDisplayName,
  mapGroupImportRows,
} from "./driver-group-import";

function rider(overrides: Partial<ImportLookupMatch> = {}): ImportLookupMatch {
  return {
    driver_id: "d1",
    employee_id: "4001",
    driver_code: "10001",
    full_name: "Ahmed Eljack",
    is_blocked: false,
    archived_at: null,
    ...overrides,
  };
}

describe("mapGroupImportRows", () => {
  it("reads the official underscore template headers", () => {
    const [row] = mapGroupImportRows(
      ["employee_id", "driver_code", "driver_name"],
      [["4001", "10001", "Ahmed Eljack"]],
    );
    assert.deepEqual(row, {
      employee_id: "4001",
      driver_code: "10001",
      name: "Ahmed Eljack",
    });
  });

  it("reads Driver ID and Full Name labels", () => {
    const [row] = mapGroupImportRows(
      ["Employee ID", "Driver ID", "Full Name"],
      [["4001", "10099", "Ahmed Eljack"]],
    );
    assert.equal(row?.driver_code, "10099");
    assert.equal(row?.name, "Ahmed Eljack");
  });
});

describe("decideGroupImportRow", () => {
  it("still accepts employee ID alone when code and name are blank", () => {
    const decided = decideGroupImportRow({
      employeeId: "4001",
      driverCode: "",
      name: "",
      byEmployee: rider(),
      byCode: null,
    });
    assert.equal(decided.status, "ok");
  });

  it("still accepts driver code alone when employee ID is blank", () => {
    const decided = decideGroupImportRow({
      employeeId: "",
      driverCode: "10001",
      name: "",
      byEmployee: null,
      byCode: rider(),
    });
    assert.equal(decided.status, "ok");
  });

  it("rejects Driver ID header + wrong code + correct emp/name (QA a)", () => {
    const [mapped] = mapGroupImportRows(
      ["Employee ID", "Driver ID", "Name"],
      [["4001", "10099", "Ahmed Eljack"]],
    );
    const decided = decideGroupImportRow({
      employeeId: mapped?.employee_id,
      driverCode: mapped?.driver_code,
      name: mapped?.name,
      byEmployee: rider(),
      byCode: null,
    });
    assert.equal(mapped?.driver_code, "10099");
    assert.equal(decided.status, "unknown_id");
    assert.equal(
      groupImportDisplayName(decided.status, mapped?.name ?? "", decided.driver?.full_name ?? null),
      "Ahmed Eljack",
    );
  });

  it("rejects valid emp + invalid code + invalid name and keeps the uploaded name (QA b)", () => {
    const decided = decideGroupImportRow({
      employeeId: "4001",
      driverCode: "99999",
      name: "test",
      byEmployee: rider(),
      byCode: null,
    });
    assert.equal(decided.status, "unknown_id");
    assert.equal(groupImportDisplayName(decided.status, "test", "Ahmed Eljack"), "test");
  });

  it("rejects when IDs match but the uploaded name does not", () => {
    const decided = decideGroupImportRow({
      employeeId: "4001",
      driverCode: "10001",
      name: "test",
      byEmployee: rider(),
      byCode: rider(),
    });
    assert.equal(decided.status, "mismatch");
    assert.equal(groupImportDisplayName("mismatch", "test", "Ahmed Eljack"), "test");
  });

  it("does not reject a missing name when IDs match", () => {
    const decided = decideGroupImportRow({
      employeeId: "4001",
      driverCode: "10001",
      name: "",
      byEmployee: rider(),
      byCode: rider(),
    });
    assert.equal(decided.status, "ok");
  });
});
