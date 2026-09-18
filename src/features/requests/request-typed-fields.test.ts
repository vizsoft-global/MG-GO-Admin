import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatFieldValue, getExtraPayloadRows } from "./request-typed-fields";
import type { RequestDetail } from "./types";

describe("formatFieldValue", () => {
  it("formats a date-only value as a Kuwait calendar day", () => {
    assert.equal(formatFieldValue("2026-09-17"), "17 Sep 2026");
  });
});

describe("getExtraPayloadRows", () => {
  it("does not dump the reschedule object as JSON", () => {
    const request = {
      request_type: "leave",
      payload: {
        leave_type: "annual",
        awaiting_driver_reschedule: true,
        reschedule: {
          proposed_start: "2026-09-20",
          proposed_end: "2026-09-22",
          note: "Need later dates",
          accepted: false,
          driver_note: "Clash",
        },
      },
    } as RequestDetail;
    const extras = getExtraPayloadRows(request);
    assert.equal(
      extras.some((row) => row.key === "reschedule" || String(row.value).includes("proposed_start")),
      false,
    );
  });
});
