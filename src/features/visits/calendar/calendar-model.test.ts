import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { busiestDays, monthCells, serviceMix, topServices } from "./calendar-model";

describe("calendar model", () => {
  it("mixes recorded departments and ranks the busiest date", () => {
    const departments = { hr: 2, legal: 1 };
    assert.deepEqual(topServices(departments, 3), [
      { key: "hr", count: 2 },
      { key: "legal", count: 1 },
    ]);
    const mix = serviceMix([{ departments }]);
    assert.equal(mix.find((row) => row.key === "hr")?.share, 2 / 3);
    assert.equal(
      mix.reduce((sum, row) => sum + row.count, 0),
      3,
    );
    const ranked = busiestDays([
      { date: "2026-10-02", booked: 1, capacity: 8 },
      { date: "2026-10-26", booked: 4, capacity: 8 },
      { date: "2026-10-10", booked: 2, capacity: 8 },
    ]);
    assert.equal(ranked[0]?.date, "2026-10-26");
    assert.equal(ranked[0]?.booked, 4);
  });

  it("starts October 2026 on the previous Sunday", () => {
    const cells = monthCells(2026, 9);
    assert.equal(cells[0]?.ymd, "2026-09-27");
    assert.equal(cells[0]?.outside, true);
    assert.equal(cells[4]?.ymd, "2026-10-01");
    assert.equal(cells[4]?.outside, false);
    assert.equal(cells.length % 7, 0);
  });
});
