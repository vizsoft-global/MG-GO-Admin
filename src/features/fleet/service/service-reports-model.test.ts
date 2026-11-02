import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildServiceReport,
  ownershipOf,
  plausibleCost,
  reportDrillDownParams,
} from "./service-reports-model";
import type { ServiceDoneRecord } from "./types";

function record(overrides: Partial<ServiceDoneRecord> & { id: string }): ServiceDoneRecord {
  return {
    vehicleId: "v1",
    vehiclePlate: "PLT-1",
    serviceTypeKey: "oil_filter",
    serviceTypeLabel: "Oil filter",
    category: "engine",
    vendor: "Workshop A",
    costKwd: 10,
    parts: [],
    doneDay: "2026-01-10",
    ...overrides,
  };
}

describe("service cost report", () => {
  it("splits rented (Contract) from company-owned (Service)", () => {
    assert.equal(ownershipOf("rent"), "contract");
    assert.equal(ownershipOf("company"), "service");
    assert.equal(ownershipOf("maintenance"), "service");
    assert.equal(ownershipOf(null), "service");

    const report = buildServiceReport({
      records: [
        record({ id: "a", vehicleId: "rented", costKwd: 100, doneDay: "2026-02-03" }),
        record({ id: "b", vehicleId: "owned", costKwd: 40, doneDay: "2026-02-05" }),
      ],
      carTypeByVehicleId: new Map([
        ["rented", "rent"],
        ["owned", "company"],
      ]),
    });
    assert.equal(report.monthly.length, 1);
    assert.equal(report.monthly[0]?.contractKwd, 100);
    assert.equal(report.monthly[0]?.serviceKwd, 40);
    assert.equal(report.monthly[0]?.totalKwd, 140);
    assert.equal(report.kpis.totalKwd, 140);
    assert.equal(report.kpis.records, 2);
    assert.equal(report.kpis.avgPerRecordKwd, 70);
    assert.equal(report.byOwnership[0]?.totalKwd, 100);
    assert.equal(report.byOwnership[1]?.totalKwd, 40);
  });

  it("buckets months in order across a year boundary", () => {
    const report = buildServiceReport({
      records: [
        record({ id: "a", costKwd: 5, doneDay: "2026-01-04" }),
        record({ id: "b", costKwd: 7, doneDay: "2025-12-30" }),
        record({ id: "c", costKwd: 3, doneDay: "2026-01-20" }),
      ],
      carTypeByVehicleId: new Map(),
      months: ["2025-12", "2026-01"],
    });
    assert.deepEqual(
      report.monthly.map((point) => point.month),
      ["2025-12", "2026-01"],
    );
    assert.equal(report.monthly[0]?.totalKwd, 7);
    assert.equal(report.monthly[1]?.totalKwd, 8);
    assert.equal(report.monthly[1]?.records, 2);
  });

  it("aggregates parts by qty, cost and record count", () => {
    const report = buildServiceReport({
      records: [
        record({
          id: "a",
          doneDay: "2026-03-01",
          parts: [
            { name: "Oil filter", qty: 2, unit_cost_kwd: 3, total_kwd: 6 },
            { name: "Spark plug", qty: 4, unit_cost_kwd: 1.5, total_kwd: 6 },
          ],
        }),
        record({
          id: "b",
          doneDay: "2026-03-09",
          parts: [{ name: "oil filter", qty: 1, unit_cost_kwd: 4, total_kwd: 4 }],
        }),
      ],
      carTypeByVehicleId: new Map(),
    });
    const oil = report.parts.find((part) => part.name.toLowerCase() === "oil filter");
    assert.ok(oil);
    assert.equal(oil?.qty, 3);
    assert.equal(oil?.totalKwd, 10);
    assert.equal(oil?.records, 2);
    assert.equal(oil?.monthly.length, 1);
    assert.equal(oil?.monthly[0]?.totalKwd, 10);
    assert.equal(report.kpis.mostReplacedPart?.name.toLowerCase(), "spark plug");
    assert.equal(report.kpis.mostExpensiveVehicle?.key, "v1");
  });

  it("groups breakdowns by category, type, vendor and vehicle", () => {
    const report = buildServiceReport({
      records: [
        record({ id: "a", category: "brakes", costKwd: 20, vehicleId: "v1" }),
        record({ id: "b", category: "brakes", costKwd: 5, vehicleId: "v2", vehiclePlate: "PLT-2" }),
        record({ id: "c", category: "engine", costKwd: 50, vendor: "Workshop B" }),
      ],
      carTypeByVehicleId: new Map(),
    });
    assert.equal(report.byCategory[0]?.key, "engine");
    assert.equal(report.byCategory[0]?.totalKwd, 50);
    const brakes = report.byCategory.find((row) => row.key === "brakes");
    assert.equal(brakes?.totalKwd, 25);
    assert.equal(brakes?.records, 2);
    assert.equal(report.byVendor.find((row) => row.key === "Workshop B")?.totalKwd, 50);
    assert.equal(report.byVehicle.length, 2);
  });

  it("drill-down is a URL on the records tab", () => {
    assert.deepEqual(reportDrillDownParams({}), { tab: "records" });
    assert.deepEqual(reportDrillDownParams({ month: "2026-02", category: "brakes" }), {
      tab: "records",
      from: "2026-02-01",
      to: "2026-02-31",
      category: "brakes",
    });
    const params = reportDrillDownParams({ vehicleId: "v9", vendor: "W", serviceTypeKey: "oil" });
    assert.equal(params.vehicle, "v9");
    assert.equal(params.vendor, "W");
    assert.equal(params.type, "oil");
    assert.equal(params.tab, "records");
  });

  it("a junk legacy cost cannot reach a total or the chart", () => {
    assert.equal(plausibleCost(45), 45);
    assert.equal(plausibleCost(0), 0);
    assert.equal(plausibleCost(null), 0);
    assert.equal(plausibleCost(-5), 0);
    assert.equal(plausibleCost(Number.NaN), 0);
    assert.equal(plausibleCost(2.3456709654312347e75), 0);

    const report = buildServiceReport({
      records: [
        record({ id: "ok", costKwd: 100, doneDay: "2026-02-03" }),
        record({ id: "junk", costKwd: 2.3456709654312347e75, doneDay: "2026-02-04" }),
      ],
      carTypeByVehicleId: new Map(),
      months: ["2026-02"],
    });
    assert.equal(report.kpis.totalKwd, 100);
    assert.equal(report.kpis.records, 2);
    assert.equal(report.monthly[0]?.totalKwd, 100);
    assert.ok(Number.isFinite(report.kpis.avgPerRecordKwd));
  });
});
