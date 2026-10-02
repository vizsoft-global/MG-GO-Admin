import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldRunBackgroundWork } from "./visibility";

describe("shouldRunBackgroundWork", () => {
  it("runs when the document is visible", () => {
    assert.equal(shouldRunBackgroundWork({ hidden: false }), true);
  });

  it("pauses when the document is hidden", () => {
    assert.equal(shouldRunBackgroundWork({ hidden: true }), false);
  });

  it("runs when there is no document at all", () => {
    // The server render and the fleet simulator both evaluate this with no DOM. Treating
    // that as "hidden" would silently stop every timer in the simulator, which is the one
    // place a background pause would be a defect rather than a saving.
    assert.equal(shouldRunBackgroundWork(undefined), true);
    assert.equal(shouldRunBackgroundWork(null), true);
  });

  it("treats a missing `hidden` flag as visible", () => {
    // A partial stub (tests, older embedders) must not be read as hidden by accident.
    assert.equal(shouldRunBackgroundWork({}), true);
  });
});
