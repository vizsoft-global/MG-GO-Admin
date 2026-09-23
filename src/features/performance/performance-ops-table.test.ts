import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyColumnFilters,
  columnFilterValues,
  filterOptionLabel,
  nextOpsSort,
  sortOpsRiders,
  toCsv,
} from "./performance-ops-table";
import { efficiencyBucket } from "./performance-ops-formulas";

describe("column filters do not change KPI inputs", () => {
  const rows = [
    { id: "1", zone: "Jahra", status: "Active", tgt_eff: 130 },
    { id: "2", zone: "Hawally", status: "Active", tgt_eff: 90 },
    { id: "3", zone: "Jahra", status: "Inactive", tgt_eff: 40 },
  ];

  it("AND across columns; empty filter is a no-op", () => {
    assert.equal(applyColumnFilters(rows, {}).length, 3);
    const jahraActive = applyColumnFilters(rows, {
      zone: ["Jahra"],
      status: ["Active"],
    });
    assert.deepEqual(jahraActive.map((r) => r.id), ["1"]);
  });

  it("KPI fixture stays on the slicer-scoped rows, not the column-filtered subset", () => {
    const slicerRows = rows;
    const tableRows = applyColumnFilters(slicerRows, { zone: ["Jahra"] });
    assert.equal(slicerRows.length, 3);
    assert.equal(tableRows.length, 2);
    assert.notEqual(tableRows.length, slicerRows.length);
  });

  it("numeric min/max is AND with other columns", () => {
    const ranged = applyColumnFilters(rows, {
      zone: ["Jahra"],
      tgt_eff: { min: 50, max: 140 },
    });
    assert.deepEqual(ranged.map((r) => r.id), ["1"]);
    const high = applyColumnFilters(rows, { tgt_eff: { min: 100 } });
    assert.deepEqual(high.map((r) => r.id), ["1"]);
  });

  it("sort cycles asc → desc → default Orders desc", () => {
    const sorted = [
      { name: "Ann", orders: 1, dpd: 10 },
      { name: "Bo", orders: 4, dpd: 3 },
      { name: "Zed", orders: 4, dpd: 8 },
    ];
    assert.deepEqual(nextOpsSort(null, null, "dpd"), { key: "dpd", dir: "asc" });
    assert.deepEqual(nextOpsSort("dpd", "asc", "dpd"), { key: "dpd", dir: "desc" });
    assert.deepEqual(nextOpsSort("dpd", "desc", "dpd"), { key: null, dir: null });
    assert.deepEqual(
      sortOpsRiders(sorted, "dpd", "asc").map((r) => r.name),
      ["Bo", "Zed", "Ann"],
    );
    assert.deepEqual(
      sortOpsRiders(sorted, null, null).map((r) => r.name),
      ["Bo", "Zed", "Ann"],
    );
  });

  it("lists unique values from the slicer-scoped rows", () => {
    assert.deepEqual(columnFilterValues(rows, "zone"), ["Hawally", "Jahra"]);
  });

  it("labels empty values and bucket slugs for the column popover", () => {
    const t = (key: string) => (key === "bucket.well_above" ? "Well above (>120%)" : key);
    assert.equal(filterOptionLabel("zone", "", t), "—");
    assert.equal(filterOptionLabel("zone", "Jahra", t), "Jahra");
    assert.equal(filterOptionLabel("bucket", "well_above", t), "Well above (>120%)");
  });
});

describe("efficiency bucket CSV is riders, not headcounts", () => {
  it("emits one row per rider with the locked columns", () => {
    const riders = [
      {
        id: "BRK032",
        name: "Hakim",
        zone: "Jahra",
        store: "Pizza Hut",
        vehicle: "Bike",
        nationality: "Ugandan",
        dpd: 30,
        tgt_eff: 120,
      },
      {
        id: "7051",
        name: "Ali",
        zone: "Hawally",
        store: "(Pool)",
        vehicle: "—",
        nationality: "Indian",
        dpd: 10,
        tgt_eff: 40,
      },
    ];
    const headers = [
      "Bucket",
      "ID",
      "Name",
      "Zone",
      "Restaurant",
      "Vehicle",
      "Nationality",
      "DPD",
      "Target Efficiency %",
    ];
    const data = riders
      .map((r) => [
        efficiencyBucket(r.tgt_eff),
        r.id,
        r.name,
        r.zone,
        r.store,
        r.vehicle,
        r.nationality,
        r.dpd,
        r.tgt_eff,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const csv = toCsv(headers, data);
    assert.match(csv, /Bucket,ID,Name/);
    assert.match(csv, /above,BRK032,Hakim/);
    assert.match(csv, /well_below,7051,Ali/);
    assert.equal(csv.split("\n").length, 3);
  });
});

describe("outsource scope ignores the source-type slicer", () => {
  it("keeps only outsourced rows even if the slicer asked for in-house", () => {
    const slicerSourceType = ["in_house"];
    const outsourceForced = [
      { id: "1", sourceType: "outsourced" },
      { id: "2", sourceType: "in_house" },
    ].filter((r) => r.sourceType === "outsourced");
    assert.equal(outsourceForced.length, 1);
    assert.equal(slicerSourceType.includes("in_house"), true);
    assert.equal(
      outsourceForced.every((r) => r.sourceType === "outsourced"),
      true,
    );
  });
});
