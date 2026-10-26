import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectKeyMatches } from "./project-key";

describe("projectKeyMatches", () => {
  it("treats a blank project as unassigned and keeps Keeta off that set", () => {
    assert.equal(projectKeyMatches("", "unassigned"), true);
    assert.equal(projectKeyMatches(null, "unassigned"), true);
    assert.equal(projectKeyMatches(" Unassigned ", "unassigned"), true);
    assert.equal(projectKeyMatches("keeta", "unassigned"), false);
    assert.equal(projectKeyMatches("Keeta", "keeta"), true);
    assert.equal(projectKeyMatches("", "keeta"), false);
    assert.equal(projectKeyMatches("americana", "keeta"), false);
  });
});
