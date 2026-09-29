import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareScalars,
  opsZonesToRankRows,
  percent,
  rankByCount,
  rankOrdersZoneResult,
} from "./assistant-analytics";
import { lastMonthRange, lastWeekRange } from "./assistant-dates";
import { ASSISTANT_RANK_CAP } from "./assistant-entity";
import { assistantSystemPrompt } from "./assistant-prompt";

describe("analytics helpers", () => {
  it("computes percentages from numerators only", () => {
    assert.equal(percent(1, 4), 25);
    assert.equal(percent(1, 3), 33.3);
    assert.equal(percent(0, 0), null);
    assert.equal(percent(2, 0), null);
  });

  it("compares two windows without inventing missing sides", () => {
    const delta = compareScalars(
      { orders: 10, riders: 4, overall_dpd: 22.5 },
      { orders: 8, riders: 4, overall_dpd: null },
    );
    assert.deepEqual(delta.orders, { current: 10, previous: 8, delta: 2 });
    assert.deepEqual(delta.riders, { current: 4, previous: 4, delta: 0 });
    assert.equal(delta.overall_dpd?.delta, null);
  });

  it("maps ops by_zone to rank rows, keeps Unassigned, and caps at 10", () => {
    const rows = [
      { key: "Jahra", id: "z1", orders: 12 },
      { key: "Unassigned", id: null, orders: 40 },
      { key: "Hawally", id: "z2", orders: 99 },
      { key: "Salmiya", id: "z3", orders: 8 },
      { key: "Farwaniya", id: "z4", orders: 31 },
      { key: "Ahmadi", id: "z5", orders: 22 },
      { key: "Mubarak", id: "z6", orders: 18 },
      { key: "Fahaheel", id: "z7", orders: 15 },
      { key: "Ardiya", id: "z8", orders: 11 },
      { key: "Shuwaikh", id: "z9", orders: 9 },
      { key: "Khaitan", id: "z10", orders: 7 },
      { key: "Jleeb", id: "z11", orders: 5 },
    ];
    const mapped = opsZonesToRankRows(rows);
    assert.equal(mapped.find((row) => row.label === "Unassigned")?.count, 40);
    assert.equal(mapped.find((row) => row.label === "Unassigned")?.id, undefined);
    const top = rankByCount(mapped, ASSISTANT_RANK_CAP);
    assert.equal(top[0]?.label, "Hawally");
    assert.equal(top[0]?.count, 99);
    assert.ok(top.some((row) => row.label === "Unassigned"));
    assert.equal(top.length, 10);
    assert.ok(!top.some((row) => row.label === "Jleeb"));
  });

  it("headline is the top zone count, never a fleet total", () => {
    const window = { from: "2026-09-20", to: "2026-09-26" };
    const payload = rankOrdersZoneResult(
      [
        { id: "z2", label: "Hawally", count: 99 },
        { id: "z1", label: "Jahra", count: 12 },
      ],
      window,
    );
    assert.deepEqual(payload.headline, { zone: "Hawally", orders: 99, id: "z2" });
    assert.equal(payload.window.from, window.from);
    assert.equal("fleet_orders" in payload, false);
    assert.match(payload.cite, /headline\.zone/);
    assert.equal(rankOrdersZoneResult([], window).headline, null);
  });

  it("tells the model to reuse rank_orders_zone on how-many follow-ups", () => {
    const en = assistantSystemPrompt("en", null);
    const ar = assistantSystemPrompt("ar", null);
    assert.match(en, /kind=rank_orders_zone/);
    assert.match(en, /how many orders\?/);
    assert.match(en, /do not switch to deliveries_counts/i);
    assert.match(en, /headline\.zone and headline\.orders/);
    assert.match(ar, /rank_orders_zone/);
    assert.match(ar, /لا تنتقل إلى deliveries_counts/);
  });

  it("ranks complaint counts and caps the list", () => {
    const top = rankByCount(
      [
        { id: "z1", label: "Jahra", count: 2 },
        { id: "z2", label: "Hawally", count: 9 },
        { id: "z3", label: "Salmiya", count: 4 },
      ],
      2,
    );
    assert.deepEqual(
      top.map((row) => row.label),
      ["Hawally", "Salmiya"],
    );
  });

  it("keeps last_week / last_month as previous windows for compare", () => {
    assert.deepEqual(lastWeekRange("2026-09-21"), { from: "2026-09-12", to: "2026-09-18" });
    assert.deepEqual(lastMonthRange("2026-09-21"), { from: "2026-08-01", to: "2026-08-31" });
    assert.deepEqual(lastMonthRange("2026-01-05"), { from: "2025-12-01", to: "2025-12-31" });
  });
});
