import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { upcomingVisitCount } from "./visit-upcoming";

describe("upcomingVisitCount", () => {
  it("counts only dates strictly after the Kuwait today", () => {
    const rows = [
      { scheduled_date: "2026-09-17" },
      { scheduled_date: "2026-09-18" },
      { scheduled_date: "2026-09-19" },
      { scheduled_date: null },
    ];
    assert.equal(upcomingVisitCount(rows, "2026-09-18"), 1);
  });

  it("is the same figure a KPI tile and tab badge should share", () => {
    const rows = [
      { scheduled_date: "2026-09-20" },
      { scheduled_date: "2026-09-21" },
    ];
    const today = "2026-09-18";
    const kpi = upcomingVisitCount(rows, today);
    const badge = upcomingVisitCount(rows, today);
    assert.equal(kpi, badge);
    assert.equal(kpi, 2);
  });
});
