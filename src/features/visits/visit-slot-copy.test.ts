import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextDefaultBranchUpdates,
  planVisitWeekdaySlotCopy,
  pickSlotCopySource,
  weekdaySlotMatchKey,
  type RecurringVisitSlot,
  type VisitBranchForCopy,
} from "./visit-slot-copy";

const tower: VisitBranchForCopy = { id: "tower", is_default: true, is_active: true };
const hawally: VisitBranchForCopy = { id: "hawally", is_default: false, is_active: true };
const inactive: VisitBranchForCopy = { id: "inactive", is_default: false, is_active: false };

function slot(
  branchId: string,
  extra: Partial<RecurringVisitSlot> = {},
): RecurringVisitSlot {
  return {
    branch_id: branchId,
    department_key: "hr_services",
    slot_date: null,
    day_of_week: 0,
    start_time: "09:00:00",
    end_time: "09:30:00",
    capacity: 2,
    is_active: true,
    ...extra,
  };
}

describe("nextDefaultBranchUpdates", () => {
  it("clears the previous default so only one is_default remains", () => {
    const plan = nextDefaultBranchUpdates([tower, hawally], "hawally");
    assert.deepEqual(plan, { ok: true, already: false, clearIds: ["tower"] });
  });

  it("is a no-op when the row is already default", () => {
    assert.deepEqual(nextDefaultBranchUpdates([tower, hawally], "tower"), {
      ok: true,
      already: true,
    });
  });

  it("refuses an unknown branch", () => {
    assert.deepEqual(nextDefaultBranchUpdates([tower], "missing"), {
      ok: false,
      error: "not_found",
    });
  });
});

describe("planVisitWeekdaySlotCopy", () => {
  it("copies recurring weekday slots onto other active branches", () => {
    const planned = planVisitWeekdaySlotCopy(
      [tower, hawally, inactive],
      [slot("tower"), slot("tower", { day_of_week: 1, start_time: "10:00:00", end_time: "10:30:00" })],
    );
    assert.equal(planned.sourceBranchId, "tower");
    assert.equal(planned.inserts.length, 2);
    assert.ok(planned.inserts.every((row) => row.branch_id === "hawally"));
    assert.ok(planned.inserts.every((row) => row.slot_date === null));
  });

  it("skips a target that already matches dept / dow / start / end", () => {
    const first = planVisitWeekdaySlotCopy([tower, hawally], [slot("tower")]);
    assert.equal(first.inserts.length, 1);
    const afterCopy: RecurringVisitSlot[] = [
      slot("tower"),
      { ...first.inserts[0], id: "copied" },
    ];
    const second = planVisitWeekdaySlotCopy([tower, hawally], afterCopy);
    assert.equal(second.inserts.length, 0);
  });

  it("a second run against the same catalog inserts nothing (no duplicates)", () => {
    const catalog = [slot("tower"), slot("hawally")];
    const first = planVisitWeekdaySlotCopy([tower, hawally], catalog);
    const second = planVisitWeekdaySlotCopy(
      [tower, hawally],
      [...catalog, ...first.inserts],
    );
    assert.equal(first.inserts.length, 0);
    assert.equal(second.inserts.length, 0);
  });

  it("ignores dated one-off slots and never emits booking fields", () => {
    const planned = planVisitWeekdaySlotCopy(
      [tower, hawally],
      [
        slot("tower", { slot_date: "2026-09-20", day_of_week: null }),
        slot("tower"),
      ],
    );
    assert.equal(planned.inserts.length, 1);
    assert.equal(planned.inserts[0].slot_date, null);
    assert.equal("booking_id" in planned.inserts[0], false);
  });

  it("prefers the default branch when it has recurring slots", () => {
    assert.equal(
      pickSlotCopySource(
        [tower, hawally],
        [slot("tower"), slot("hawally"), slot("hawally", { day_of_week: 1 })],
      ),
      "tower",
    );
  });

  it("normalizes 09:00 and 09:00:00 as the same match key", () => {
    assert.equal(
      weekdaySlotMatchKey({
        department_key: "hr_services",
        day_of_week: 0,
        start_time: "09:00",
        end_time: "09:30",
      }),
      weekdaySlotMatchKey({
        department_key: "hr_services",
        day_of_week: 0,
        start_time: "09:00:00",
        end_time: "09:30:00",
      }),
    );
  });
});
