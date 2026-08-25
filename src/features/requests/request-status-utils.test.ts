import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { statusFiltersForRequestType } from "./request-status-utils";

describe("statusFiltersForRequestType", () => {
  it("hides fuel-unused queues on the Fuel list", () => {
    assert.deepEqual(statusFiltersForRequestType("fuel"), [
      "all",
      "submitted",
      "pending",
      "in_review",
      "needs_clarification",
      "approved",
      "rejected",
      "closed",
    ]);
  });

  it("keeps the full set on All Requests and other types", () => {
    assert.ok(statusFiltersForRequestType("all").includes("rescheduled"));
    assert.ok(statusFiltersForRequestType("leave").includes("rescheduled"));
    assert.ok(statusFiltersForRequestType("complaint").includes("solved"));
    assert.ok(statusFiltersForRequestType("complaint").includes("responded"));
  });
});
