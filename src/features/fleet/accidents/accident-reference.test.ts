import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACCIDENT_REFERENCE_COUNTER,
  accidentReferenceNumber,
  compareAccidentReference,
  formatAccidentReference,
  isAccidentReference,
  nextAccidentReference,
  projectAccidentReferences,
} from "./accident-reference";

describe("accident reference", () => {
  it("formats ACC-0001 and keeps four digits", () => {
    assert.equal(formatAccidentReference(1), "ACC-0001");
    assert.equal(formatAccidentReference(42), "ACC-0042");
    assert.equal(formatAccidentReference(9999), "ACC-9999");
    // Above four digits the number simply grows; it is never truncated.
    assert.equal(formatAccidentReference(10000), "ACC-10000");
  });

  it("prints nothing for a value below one", () => {
    assert.equal(formatAccidentReference(0), "");
    assert.equal(formatAccidentReference(-3), "");
    assert.equal(formatAccidentReference(Number.NaN), "");
  });

  it("round-trips through the parser and rejects anything else", () => {
    assert.equal(accidentReferenceNumber("ACC-0007"), 7);
    assert.equal(accidentReferenceNumber("acc-0007"), null);
    assert.equal(accidentReferenceNumber("ACC-"), null);
    assert.equal(accidentReferenceNumber("RST-0007"), null);
    assert.equal(accidentReferenceNumber(null), null);
    assert.equal(isAccidentReference("ACC-0001"), true);
    assert.equal(isAccidentReference("ACC-1"), false);
  });

  it("names the next allocation without touching the counter", () => {
    assert.equal(nextAccidentReference(0), "ACC-0001");
    assert.equal(nextAccidentReference(9), "ACC-0010");
  });

  it("projects a dry-run range and returns the counter unchanged", () => {
    const projection = projectAccidentReferences(7, 3);
    assert.equal(projection.current, 7);
    assert.deepEqual(projection.projected, ["ACC-0008", "ACC-0009", "ACC-0010"]);
    assert.equal(projection.range, "ACC-0008 … ACC-0010");
    // The pure projector cannot increment: it only formats what it is handed.
    assert.equal(projectAccidentReferences(7, 3).current, 7);
    assert.equal(projectAccidentReferences(0, 0).projected.length, 0);
  });

  it("names the one counter document", () => {
    assert.equal(ACCIDENT_REFERENCE_COUNTER, "accident_reference_seq");
  });

  it("sorts the newest reference first and an un-numbered row last", () => {
    const sorted = ["ACC-0002", null, "ACC-0010"].sort(compareAccidentReference);
    assert.deepEqual(sorted, ["ACC-0010", "ACC-0002", null]);
  });
});
