import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveScreenshotRestricted,
  screenshotRestrictedToFcmValue,
} from "./screenshot-restriction";

describe("resolveScreenshotRestricted", () => {
  it("inherits template when override is null", () => {
    assert.equal(resolveScreenshotRestricted(null, true), true);
    assert.equal(resolveScreenshotRestricted(null, false), false);
    assert.equal(resolveScreenshotRestricted(undefined, true), true);
  });

  it("forces on/off when override is set", () => {
    assert.equal(resolveScreenshotRestricted(true, false), true);
    assert.equal(resolveScreenshotRestricted(false, true), false);
  });

  it("defaults to false when both missing", () => {
    assert.equal(resolveScreenshotRestricted(null, null), false);
    assert.equal(resolveScreenshotRestricted(undefined, undefined), false);
  });
});

describe("screenshotRestrictedToFcmValue", () => {
  it("maps boolean to string", () => {
    assert.equal(screenshotRestrictedToFcmValue(true), "true");
    assert.equal(screenshotRestrictedToFcmValue(false), "false");
  });
});
