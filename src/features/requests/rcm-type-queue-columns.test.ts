import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isQueueRowOverdue,
  queueColumnKeys,
  queueDayCount,
  queueScopeFromParam,
  RCM_QUEUE_TYPES,
} from "./rcm-type-queue-columns";

describe("rcm type queue columns", () => {
  it("maps each request type to one column pair", () => {
    assert.deepEqual(queueColumnKeys("loan"), ["amount", "repayment"]);
    assert.deepEqual(queueColumnKeys("leave"), ["fromTo", "days"]);
    assert.deepEqual(queueColumnKeys("sick_leave"), ["fromTo", "days"]);
    assert.deepEqual(queueColumnKeys("fuel"), ["amount", "vehicle"]);
    assert.deepEqual(queueColumnKeys("fuel_refund"), ["amount", "vehicle"]);
    assert.deepEqual(queueColumnKeys("asset"), ["item"]);
    assert.deepEqual(queueColumnKeys("complaint"), ["category", "severity"]);
    assert.deepEqual(queueColumnKeys("salary_justification"), ["month"]);
    assert.deepEqual(queueColumnKeys("document"), ["subject"]);
    assert.equal(RCM_QUEUE_TYPES.length, 9);
  });

  it("maps Handled by me onto the existing handled scope", () => {
    assert.equal(queueScopeFromParam("handled"), "handled");
    assert.equal(queueScopeFromParam("assigned"), "assigned");
    assert.equal(queueScopeFromParam("action"), "assigned");
    assert.equal(queueScopeFromParam("forwarded"), "forwarded");
    assert.equal(queueScopeFromParam("all"), "all");
    assert.equal(queueScopeFromParam("due"), "assigned");
    assert.equal(queueScopeFromParam(null), "assigned");
  });

  it("counts inclusive days and flags an overdue open row", () => {
    assert.equal(queueDayCount("2026-09-01", "2026-09-03"), "3");
    assert.equal(queueDayCount(null, "2026-09-03"), null);
    const now = Date.parse("2026-10-01T00:00:00Z");
    assert.equal(
      isQueueRowOverdue(
        { status: "in_review", createdAt: "2026-09-30T00:00:00Z", slaDueAt: "2026-09-20T00:00:00Z" },
        now,
      ),
      true,
    );
    assert.equal(
      isQueueRowOverdue(
        { status: "approved", createdAt: "2026-01-01T00:00:00Z", slaDueAt: null },
        now,
      ),
      false,
    );
  });
});
