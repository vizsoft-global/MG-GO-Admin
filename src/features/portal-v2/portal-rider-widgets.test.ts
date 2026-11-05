import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bucketsForWidget,
  filterRidersByWidget,
  pageSlice,
  pageWindow,
  riderCountsByWidget,
  riderMatchesWidget,
  type PortalRiderRow,
} from "./portal-rider-widgets";

const rows: PortalRiderRow[] = [
  { employeeId: "1001", name: "A", zone: "Salmiya", bucket: "working", status: "running" },
  { employeeId: "1002", name: "B", zone: "Salmiya", bucket: "working", status: "running" },
  { employeeId: "1003", name: "C", zone: "Jahra", bucket: "onLeave", status: "leave" },
  { employeeId: "1004", name: "D", zone: "Jahra", bucket: "sick", status: "running" },
  { employeeId: "1005", name: "E", zone: "Farwaniya", bucket: "absent", status: "cancelled" },
  { employeeId: "1006", name: "F", zone: "Farwaniya", bucket: "other", status: "suspended" },
];

describe("rider widget buckets", () => {
  it("counts each card off the same rows the table filters", () => {
    const counts = riderCountsByWidget(rows);
    assert.deepEqual(counts, {
      assigned: 6,
      working: 2,
      onLeave: 1,
      // Absent / sick is one card over two buckets.
      absentSick: 2,
      notMarked: 1,
    });
  });

  it("opening a card yields exactly the number printed on it", () => {
    for (const widget of ["working", "onLeave", "absentSick", "notMarked"] as const) {
      const opened = filterRidersByWidget(rows, widget);
      assert.equal(opened.length, riderCountsByWidget(rows)[widget], widget);
    }
  });

  it("assigned opens every rider", () => {
    assert.equal(filterRidersByWidget(rows, "assigned").length, rows.length);
  });

  it("absent / sick selects both buckets, not one", () => {
    assert.deepEqual(bucketsForWidget("absentSick"), ["absent", "sick"]);
    const opened = filterRidersByWidget(rows, "absentSick");
    assert.deepEqual(
      opened.map((row) => row.bucket),
      ["sick", "absent"],
    );
  });

  it("a rider's account status does not decide the bucket", () => {
    // 1004 is `running` as an account and sick today; 1005 is `cancelled` and
    // absent. Filtering on `status` would put both under the wrong card.
    const sick = rows.find((row) => row.employeeId === "1004");
    assert.ok(sick);
    assert.equal(riderMatchesWidget(sick, "working"), false);
    assert.equal(riderMatchesWidget(sick, "absentSick"), true);

    const absent = rows.find((row) => row.employeeId === "1005");
    assert.ok(absent);
    assert.equal(riderMatchesWidget(absent, "working"), false);
  });

  it("no widget selected means no table", () => {
    assert.deepEqual(filterRidersByWidget(rows, null), []);
  });
});

describe("pageSlice", () => {
  const many = Array.from({ length: 209 }, (_, index) => index);

  it("reports the range the footer prints", () => {
    const first = pageSlice(many, 0, 8);
    assert.deepEqual({ from: first.from, to: first.to, pageCount: first.pageCount }, {
      from: 1,
      to: 8,
      pageCount: 27,
    });
    const last = pageSlice(many, 26, 8);
    assert.deepEqual({ from: last.from, to: last.to }, { from: 209, to: 209 });
  });

  it("clamps a page that the filter shrank past", () => {
    const paged = pageSlice(many.slice(0, 5), 20, 8);
    assert.equal(paged.page, 0);
    assert.equal(paged.slice.length, 5);
  });

  it("an empty roster reports zero rows, not 1", () => {
    const paged = pageSlice([], 0, 8);
    assert.equal(paged.from, 0);
    assert.equal(paged.to, 0);
    assert.equal(paged.pageCount, 1);
  });
});

describe("pageWindow", () => {
  it("lists every page when they fit", () => {
    assert.deepEqual(pageWindow(0, 5), [0, 1, 2, 3, 4]);
  });

  it("first, last and two either side, with gaps", () => {
    assert.deepEqual(pageWindow(13, 27), [0, null, 11, 12, 13, 14, 15, null, 26]);
  });

  it("no gap marker between adjacent pages", () => {
    assert.deepEqual(pageWindow(2, 27), [0, 1, 2, 3, 4, null, 26]);
  });

  it("never prints a page past the end", () => {
    assert.deepEqual(pageWindow(99, 27), [0, null, 24, 25, 26]);
  });
});
