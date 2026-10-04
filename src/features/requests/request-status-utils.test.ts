import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canBulkSelectRequest,
  REQUEST_STATUS_FILTERS,
  statusFiltersForRequestType,
} from "./request-status-utils";

describe("statusFiltersForRequestType", () => {
  it("hides unused queues on Fuel and Asset lists", () => {
    const expected = [
      "all",
      "submitted",
      "pending",
      "in_review",
      "needs_clarification",
      "approved",
      "rejected",
      "closed",
    ];
    assert.deepEqual(statusFiltersForRequestType("fuel"), expected);
    assert.deepEqual(statusFiltersForRequestType("fuel_refund"), expected);
    assert.deepEqual(statusFiltersForRequestType("asset"), expected);
  });

  it("keeps the full set on All Requests and other types", () => {
    assert.ok(statusFiltersForRequestType("all").includes("rescheduled"));
    assert.ok(statusFiltersForRequestType("leave").includes("rescheduled"));
    assert.ok(statusFiltersForRequestType("complaint").includes("solved"));
    assert.ok(statusFiltersForRequestType("complaint").includes("responded"));
  });
});

describe("canBulkSelectRequest", () => {
  it("lets an open request be ticked for Approve / Reject", () => {
    for (const status of [
      "submitted",
      "pending",
      "in_review",
      "needs_clarification",
      "rescheduled",
      "overdue",
    ]) {
      assert.equal(canBulkSelectRequest(status), true, status);
    }
  });

  it("hides the checkbox once the request is decided", () => {
    for (const status of ["approved", "rejected", "solved", "responded", "closed"]) {
      assert.equal(canBulkSelectRequest(status), false, status);
    }
  });

  it("pins the selectable set to the complement of the decided set", () => {
    const decided = ["approved", "rejected", "solved", "responded", "closed"];
    const selectable = REQUEST_STATUS_FILTERS.filter(
      (status) => status !== "all" && !decided.includes(status),
    );
    assert.deepEqual(selectable, [
      "submitted",
      "pending",
      "in_review",
      "needs_clarification",
      "rescheduled",
      "overdue",
    ]);
    // Every status the panel can name is either decided or selectable — never neither,
    // because that is the shape that leaves an open queue with no checkbox on it.
    for (const status of REQUEST_STATUS_FILTERS) {
      if (status === "all") continue;
      assert.equal(canBulkSelectRequest(status), !decided.includes(status), status);
    }
  });
});
