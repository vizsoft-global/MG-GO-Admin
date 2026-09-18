import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseReschedulePayload } from "./request-reschedule-payload";

const base = {
  proposed_start: "2026-09-20",
  proposed_end: "2026-09-22",
  note: "Need later dates",
  proposed_by: "Admin",
  proposed_at: "2026-09-18T08:00:00Z",
};

describe("parseReschedulePayload", () => {
  it("reads awaiting when accepted is unset", () => {
    const parsed = parseReschedulePayload({ reschedule: { ...base } });
    assert.ok(parsed);
    assert.equal(parsed.status, "awaiting");
    assert.equal(parsed.proposedStart, "2026-09-20");
    assert.equal(parsed.proposedEnd, "2026-09-22");
    assert.equal(parsed.note, "Need later dates");
    assert.equal(parsed.driverNote, null);
  });

  it("reads accepted with the rider note", () => {
    const parsed = parseReschedulePayload({
      reschedule: { ...base, accepted: true, driver_note: "OK" },
    });
    assert.ok(parsed);
    assert.equal(parsed.status, "accepted");
    assert.equal(parsed.driverNote, "OK");
  });

  it("reads declined with the decline reason", () => {
    const parsed = parseReschedulePayload({
      reschedule: { ...base, accepted: false, driver_note: "Clash" },
    });
    assert.ok(parsed);
    assert.equal(parsed.status, "declined");
    assert.equal(parsed.driverNote, "Clash");
  });

  it("returns null when the reschedule block is missing", () => {
    assert.equal(parseReschedulePayload({ leave_type: "annual" }), null);
  });
});
