import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kuwaitSatFriWeek } from "../../lib/date/kuwait-dates";
import { inclusiveKuwaitDays, kuwaitMonthRange, resolveFuelRange, shiftFuelAnchor } from "./fuel-range";

describe("fuel range", () => {
  it("daily is the anchor day", () => {
    const result = resolveFuelRange({
      mode: "daily",
      anchor: "2026-09-11",
      customFrom: "",
      customTo: "",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.range.days, ["2026-09-11"]);
  });

  it("weekly matches the Kuwait Saturday–Friday week", () => {
    const week = kuwaitSatFriWeek("2026-09-11");
    const result = resolveFuelRange({
      mode: "weekly",
      anchor: "2026-09-11",
      customFrom: "",
      customTo: "",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.range, week);
  });

  it("monthly is the Kuwait calendar month and never exceeds 31 days", () => {
    const september = kuwaitMonthRange("2026-09-11");
    assert.equal(september.start, "2026-09-01");
    assert.equal(september.end, "2026-09-30");
    assert.equal(september.days.length, 30);
    const october = kuwaitMonthRange("2026-10-02");
    assert.equal(october.days.length, 31);
    assert.equal(october.end, "2026-10-31");
  });

  it("custom accepts 31 days and rejects a longer span or a reversed range", () => {
    const ok = inclusiveKuwaitDays("2026-09-01", "2026-10-01");
    assert.equal(ok?.length, 31);
    assert.equal(inclusiveKuwaitDays("2026-09-01", "2026-10-02"), null);
    assert.equal(inclusiveKuwaitDays("2026-09-11", "2026-09-01"), null);
    const applied = resolveFuelRange({
      mode: "custom",
      anchor: "2026-09-11",
      customFrom: "2026-09-01",
      customTo: "2026-10-02",
    });
    assert.deepEqual(applied, { ok: false, reason: "span" });
    const reversed = resolveFuelRange({
      mode: "custom",
      anchor: "2026-09-11",
      customFrom: "2026-09-11",
      customTo: "2026-09-01",
    });
    assert.deepEqual(reversed, { ok: false, reason: "order" });
  });

  it("shifts the anchor by one day, one week, or one month", () => {
    assert.equal(shiftFuelAnchor("daily", "2026-09-11", -1), "2026-09-10");
    assert.equal(shiftFuelAnchor("weekly", "2026-09-11", 1), "2026-09-12");
    assert.equal(shiftFuelAnchor("monthly", "2026-09-11", 1), "2026-10-01");
    assert.equal(shiftFuelAnchor("monthly", "2026-09-11", -1), "2026-08-31");
  });
});
