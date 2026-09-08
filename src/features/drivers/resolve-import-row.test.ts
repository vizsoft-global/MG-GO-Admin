import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideImportRowMatch, type ImportLookupMatch } from "./resolve-import-row";

function match(overrides: Partial<ImportLookupMatch> = {}): ImportLookupMatch {
  return {
    driver_id: "d1",
    employee_id: "4001",
    driver_code: "10001",
    full_name: "Rider",
    is_blocked: false,
    archived_at: null,
    ...overrides,
  };
}

describe("decideImportRowMatch", () => {
  it("matches employee ID alone", () => {
    const decided = decideImportRowMatch({
      employeeId: "4001",
      driverCode: "",
      byEmployee: match(),
      byCode: null,
    });
    assert.equal(decided.status, "ok");
    assert.equal(decided.driver?.driver_id, "d1");
  });

  it("matches driver code alone in a mixed file", () => {
    const decided = decideImportRowMatch({
      employeeId: "",
      driverCode: "10001",
      byEmployee: null,
      byCode: match(),
    });
    assert.equal(decided.status, "ok");
  });

  it("is ok when both columns name the same driver", () => {
    const same = match();
    const decided = decideImportRowMatch({
      employeeId: "4001",
      driverCode: "10001",
      byEmployee: same,
      byCode: same,
    });
    assert.equal(decided.status, "ok");
  });

  it("rejects when the two columns point at different drivers", () => {
    const decided = decideImportRowMatch({
      employeeId: "4001",
      driverCode: "10002",
      byEmployee: match({ driver_id: "d1" }),
      byCode: match({ driver_id: "d2", driver_code: "10002" }),
    });
    assert.equal(decided.status, "ambiguous");
    assert.equal(decided.driver, null);
  });

  it("rejects unknown IDs instead of skipping", () => {
    const decided = decideImportRowMatch({
      employeeId: "99999",
      driverCode: "",
      byEmployee: null,
      byCode: null,
    });
    assert.equal(decided.status, "unknown_id");
  });

  it("names blocked and archived rather than collapsing them into unknown", () => {
    assert.equal(
      decideImportRowMatch({
        employeeId: "4001",
        byEmployee: match({ is_blocked: true }),
        byCode: null,
      }).status,
      "blocked",
    );
    assert.equal(
      decideImportRowMatch({
        employeeId: "4001",
        byEmployee: match({ archived_at: "2026-01-01" }),
        byCode: null,
      }).status,
      "archived",
    );
  });

  it("treats a blank row as empty, not unknown", () => {
    assert.equal(
      decideImportRowMatch({
        employeeId: "  ",
        driverCode: "",
        byEmployee: null,
        byCode: null,
      }).status,
      "empty",
    );
  });
});
