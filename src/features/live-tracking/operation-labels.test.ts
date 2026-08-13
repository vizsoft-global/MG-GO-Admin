import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  humanizeCategory,
  humanizeErrorCode,
  humanizeOperationKey,
  operationCategoryTone,
  operationMessageKey,
} from "./operation-labels";

describe("operationMessageKey", () => {
  it("strips the dot next-intl would read as nesting", () => {
    assert.equal(operationMessageKey("delivery.pickup_create"), "delivery_pickup_create");
    assert.equal(operationMessageKey("security.mock_location"), "security_mock_location");
  });
});

describe("humanizeOperationKey", () => {
  it("drops the category prefix and reads as a sentence", () => {
    assert.equal(humanizeOperationKey("delivery.pickup_create"), "Pickup create");
    assert.equal(humanizeOperationKey("auth.passcode_lookup"), "Passcode lookup");
    assert.equal(humanizeOperationKey("duty.on"), "On");
  });

  it("handles a key with no category prefix", () => {
    assert.equal(humanizeOperationKey("heartbeat_rejected"), "Heartbeat rejected");
  });

  it("keeps the raw key when there is nothing left to humanize", () => {
    assert.equal(humanizeOperationKey("delivery."), "delivery.");
  });
});

describe("humanizeCategory / humanizeErrorCode", () => {
  it("reads underscored values as words", () => {
    assert.equal(humanizeCategory("admin_action"), "Admin action");
    assert.equal(humanizeErrorCode("active_pickup_exists"), "Active pickup exists");
  });
});

describe("operationCategoryTone", () => {
  it("marks security red and falls back to neutral for unknown categories", () => {
    assert.equal(operationCategoryTone("security"), "danger");
    assert.equal(operationCategoryTone("duty"), "success");
    assert.equal(operationCategoryTone("something_new"), "neutral");
  });
});
