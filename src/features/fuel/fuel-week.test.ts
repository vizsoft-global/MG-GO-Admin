import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kuwaitSatFriWeek } from "../../lib/date/kuwait-dates";
import { buildFuelWeekRows, isFuelRowCritical, parseFuelFillRow } from "./fuel-week";
import type { FuelFillListItem } from "./types";

function fill(partial: Partial<FuelFillListItem> & Pick<FuelFillListItem, "id" | "ymd" | "cost_kwd">): FuelFillListItem {
  return {
    filled_at: `${partial.ymd}T10:00:00+03:00`,
    litres: 10,
    station_name: "TEST · KNPC",
    lat: 29.37,
    lng: 47.97,
    driver_id: "d1",
    driver_name: "Ada",
    driver_code: "10001",
    employee_id: "E1",
    employee_company: "Talabat",
    project_key: "keeta",
    vehicle_id: "v1",
    plate: "22/21647",
    kind: "car",
    model: "Alsvin",
    fuel_type: "card",
    fuel_company: "mus",
    chip_no: "FC-5000",
    fuel_monthly_limit_kwd: 60,
    vehicle_company: "Keeta",
    zone_name: "Jahra",
    attachments: [],
    ...partial,
  };
}

describe("kuwait Sat-Fri week", () => {
  it("pins Friday 11 Sep 2026 to Sat 5 – Fri 11", () => {
    const week = kuwaitSatFriWeek("2026-09-11");
    assert.equal(week.start, "2026-09-05");
    assert.equal(week.end, "2026-09-11");
    assert.deepEqual(week.days, [
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ]);
  });
});

describe("fuel week rows", () => {
  it("marks a row critical only above 90% of the monthly cap", () => {
    assert.equal(isFuelRowCritical(54, 60), false);
    assert.equal(isFuelRowCritical(54.001, 60), true);
    assert.equal(isFuelRowCritical(10, 0), false);
  });

  it("pivots fills onto Sat-Fri cells and sums the Kuwait month", () => {
    const week = kuwaitSatFriWeek("2026-09-11");
    const rows = buildFuelWeekRows(
      [
        fill({ id: "a", ymd: "2026-09-01", cost_kwd: 20 }),
        fill({ id: "b", ymd: "2026-09-06", cost_kwd: 10, litres: 8, station_name: "OULA" }),
        fill({ id: "c", ymd: "2026-09-06", cost_kwd: 5, litres: 4, station_name: "KNPC" }),
        fill({ id: "d", ymd: "2026-08-30", cost_kwd: 99 }),
      ],
      week.days,
      "2026-09",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.withdrawn, 35);
    assert.equal(rows[0]?.critical, false);
    assert.equal(rows[0]?.days[0], null);
    assert.equal(rows[0]?.days[1]?.costKwd, 15);
    assert.equal(rows[0]?.days[1]?.litres, 12);
    assert.equal(rows[0]?.days[1]?.stationName, "KNPC");
  });

  it("parses an RPC row and drops junk", () => {
    const parsed = parseFuelFillRow({
      id: "x",
      driver_id: "d1",
      vehicle_id: "v1",
      filled_at: "2026-09-06T11:00:00+03:00",
      litres: "3.2",
      cost_kwd: "1.100",
      station_name: "TEST · KNPC Hawally",
      lat: 29.3,
      lng: 47.9,
      project_key: "keeta",
      fuel_type: "chip",
      fuel_company: "unp",
      attachments: [{ kind: "odometer", title: "Odometer reading", storage_key: "k", source: "mobile_camera" }],
    });
    assert.ok(parsed);
    assert.equal(parsed?.ymd, "2026-09-06");
    assert.equal(parsed?.attachments.length, 1);
    assert.equal(parseFuelFillRow({ id: "x" }), null);
  });
});
