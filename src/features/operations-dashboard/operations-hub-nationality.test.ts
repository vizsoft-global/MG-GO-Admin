import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emptyOperationsDashboard,
  normalizeOperationsDashboard,
  DEFAULT_OPS_HUB_CONFIG,
  type OperationsDashboard,
} from "./shape";

describe("Operations Hub Nationality and Central Customization (Items 5.1, 5.2, 5.3)", () => {
  it("initializes empty dashboard with nationality breakdown structures", () => {
    const empty = emptyOperationsDashboard();
    assert.deepEqual(empty.byNationalityCategory, []);
    assert.deepEqual(empty.byNationalityCountry, []);
  });

  it("normalizes nationality classifications and custom fields from raw API payload", () => {
    const rawPayload = {
      today: "2026-11-15",
      by_nationality_category: [
        { key: "Asian", count: 120 },
        { key: "Arab", count: 45 },
        { key: "African", count: 15 },
      ],
      by_nationality_country: [
        { key: "India", count: 80 },
        { key: "Egypt", count: 35 },
        { key: "Nepal", count: 25 },
        { key: "Bangladesh", count: 15 },
      ],
      roster: [
        {
          employee_id: "10782",
          full_name: "Rider Test 1",
          project_key: "americana",
          zone_name: "Capital",
          status: "working",
          nationality: "India",
          nationality_category: "Asian",
        },
        {
          employee_id: "10443",
          full_name: "Rider Test 2",
          project_key: "keeta",
          zone_name: "Hawally",
          status: "working",
          nationality: "Egypt",
          nationality_category: "Arab",
        },
      ],
    };

    const normalized: OperationsDashboard = normalizeOperationsDashboard(rawPayload);

    assert.equal(normalized.byNationalityCategory.length, 3);
    assert.equal(normalized.byNationalityCategory[0]?.key, "Asian");
    assert.equal(normalized.byNationalityCategory[0]?.count, 120);

    assert.equal(normalized.byNationalityCountry.length, 4);
    assert.equal(normalized.byNationalityCountry[0]?.key, "India");
    assert.equal(normalized.byNationalityCountry[0]?.count, 80);

    assert.equal(normalized.roster.length, 2);
    assert.equal(normalized.roster[0]?.nationalityCountry, "India");
    assert.equal(normalized.roster[0]?.nationalityCategory, "Asian");
    assert.equal(normalized.roster[1]?.nationalityCountry, "Egypt");
    assert.equal(normalized.roster[1]?.nationalityCategory, "Arab");
  });

  it("verifies default Operations Hub custom columns and charts configuration", () => {
    assert.ok(DEFAULT_OPS_HUB_CONFIG.customColumns.length >= 7);
    const colIds = DEFAULT_OPS_HUB_CONFIG.customColumns.map((c) => c.id);
    assert.ok(colIds.includes("nationalityCategory"));
    assert.ok(colIds.includes("nationalityCountry"));

    assert.ok(DEFAULT_OPS_HUB_CONFIG.customCharts.length >= 2);
    const chartDims = DEFAULT_OPS_HUB_CONFIG.customCharts.map((ch) => ch.dimension);
    assert.ok(chartDims.includes("nationalityCategory"));
    assert.ok(chartDims.includes("nationalityCountry"));
  });
});

