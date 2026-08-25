import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseShiftAdherence } from "./shift-adherence";

describe("parseShiftAdherence", () => {
  it("caps a stale 415 early-out at the scheduled shift length", () => {
    const parsed = parseShiftAdherence({
      scheduled_start_at: "2026-08-13T08:30:00+00:00",
      scheduled_end_at: "2026-08-13T13:30:00+00:00",
      actual_in_at: "2026-08-13T06:31:00+00:00",
      actual_out_at: "2026-08-13T06:35:00+00:00",
      minutes_late: 0,
      minutes_early_out: 415,
      online_seconds: 240,
      scheduled_seconds: 18000,
    });
    assert.equal(parsed?.minutes_early_out, 300);
  });

  it("keeps a during-shift early-out inside the window", () => {
    const parsed = parseShiftAdherence({
      scheduled_start_at: "2026-08-13T08:30:00+00:00",
      scheduled_end_at: "2026-08-13T13:30:00+00:00",
      actual_out_at: "2026-08-13T13:00:00+00:00",
      minutes_late: 0,
      minutes_early_out: 30,
      online_seconds: 0,
      scheduled_seconds: 18000,
    });
    assert.equal(parsed?.minutes_early_out, 30);
  });

  it("caps 310 when scheduled_seconds is missing by deriving the window", () => {
    const parsed = parseShiftAdherence({
      scheduled_start_at: "2026-08-13T08:30:00+00:00",
      scheduled_end_at: "2026-08-13T13:30:00+00:00",
      actual_out_at: "2026-08-13T08:20:00+00:00",
      minutes_late: 0,
      minutes_early_out: 310,
      online_seconds: 0,
    });
    assert.equal(parsed?.minutes_early_out, 300);
    assert.equal(parsed?.scheduled_seconds, 18000);
  });

  it("does not cap an overnight remaining window", () => {
    const parsed = parseShiftAdherence({
      scheduled_start_at: "2026-08-13T19:00:00+00:00",
      scheduled_end_at: "2026-08-14T07:00:00+00:00",
      actual_out_at: "2026-08-13T19:00:00+00:00",
      minutes_late: 0,
      minutes_early_out: 720,
      online_seconds: 0,
      scheduled_seconds: 43200,
    });
    assert.equal(parsed?.minutes_early_out, 720);
  });
});
