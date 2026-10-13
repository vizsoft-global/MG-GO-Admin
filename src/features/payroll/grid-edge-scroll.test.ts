import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EDGE_PX,
  EDGE_SCROLL_MAX,
  EDGE_SCROLL_MIN,
  edgeScrollDelta,
  layoutFromSampleCell,
  mapPointerToCell,
  maybeEdgeScroll,
} from "./grid-edge-scroll";

describe("edgeScrollDelta", () => {
  it("returns 0 outside the edge band", () => {
    assert.equal(edgeScrollDelta(EDGE_PX), 0);
    assert.equal(edgeScrollDelta(EDGE_PX + 1), 0);
    assert.equal(edgeScrollDelta(80), 0);
  });

  it("scales faster as the pointer gets closer to the edge", () => {
    const far = edgeScrollDelta(EDGE_PX - 1);
    const mid = edgeScrollDelta(Math.floor(EDGE_PX / 2));
    const near = edgeScrollDelta(2);
    const onEdge = edgeScrollDelta(0);
    assert.ok(far > 0);
    assert.ok(mid > far);
    assert.ok(near > mid);
    assert.ok(onEdge >= near);
  });

  it("clamps to the 4–28 px/frame band", () => {
    assert.equal(edgeScrollDelta(0), EDGE_SCROLL_MAX);
    assert.ok(edgeScrollDelta(EDGE_PX - 1) >= EDGE_SCROLL_MIN);
    assert.ok(edgeScrollDelta(0) <= EDGE_SCROLL_MAX);
    assert.equal(edgeScrollDelta(0, 20), 20);
    assert.ok(edgeScrollDelta(1, 20) <= 20);
    assert.ok(edgeScrollDelta(-12) <= EDGE_SCROLL_MAX);
    assert.ok(edgeScrollDelta(-12) >= EDGE_SCROLL_MIN);
  });
});

describe("maybeEdgeScroll", () => {
  const box = { left: 100, top: 50, right: 500, bottom: 350 };

  it("is zero when the pointer is inside and away from every edge", () => {
    assert.deepEqual(maybeEdgeScroll(box, 300, 200), { dx: 0, dy: 0 });
  });

  it("scrolls one axis when the pointer is in a single edge band", () => {
    const left = maybeEdgeScroll(box, 108, 200);
    assert.ok(left.dx < 0);
    assert.equal(left.dy, 0);

    const right = maybeEdgeScroll(box, 492, 200);
    assert.ok(right.dx > 0);
    assert.equal(right.dy, 0);

    const top = maybeEdgeScroll(box, 300, 55);
    assert.equal(top.dx, 0);
    assert.ok(top.dy < 0);

    const bottom = maybeEdgeScroll(box, 300, 340);
    assert.equal(bottom.dx, 0);
    assert.ok(bottom.dy > 0);
  });

  it("scrolls both axes in a corner and faster when closer", () => {
    const shallow = maybeEdgeScroll(box, 118, 68);
    const deep = maybeEdgeScroll(box, 102, 52);
    assert.ok(shallow.dx < 0 && shallow.dy < 0);
    assert.ok(deep.dx < 0 && deep.dy < 0);
    assert.ok(Math.abs(deep.dx) > Math.abs(shallow.dx));
    assert.ok(Math.abs(deep.dy) > Math.abs(shallow.dy));
  });

  it("keeps scrolling at max when the pointer leaves the box", () => {
    const past = maybeEdgeScroll(box, 40, 10);
    assert.equal(past.dx, -EDGE_SCROLL_MAX);
    assert.equal(past.dy, -EDGE_SCROLL_MAX);
  });
});

describe("mapPointerToCell", () => {
  const layout = {
    containerLeft: 0,
    containerTop: 0,
    scrollLeft: 0,
    scrollTop: 0,
    headerHeight: 40,
    originX: 200,
    rowHeight: 36,
    colWidth: 52,
    rowCount: 10,
    colCount: 8,
  };

  it("maps a point onto the selectable row/col", () => {
    assert.deepEqual(mapPointerToCell(200 + 52 * 2 + 10, 40 + 36 * 3 + 4, layout), {
      row: 3,
      col: 2,
    });
  });

  it("accounts for scroll on both axes", () => {
    assert.deepEqual(
      mapPointerToCell(10, 10, {
        ...layout,
        scrollLeft: 200 + 52 * 4,
        scrollTop: 40 + 36 * 5,
      }),
      { row: 5, col: 4 },
    );
  });

  it("clamps to the grid and honours colStride", () => {
    assert.deepEqual(mapPointerToCell(-20, -20, layout), { row: 0, col: 0 });
    assert.deepEqual(mapPointerToCell(9000, 9000, layout), { row: 9, col: 7 });
    assert.deepEqual(
      mapPointerToCell(200 + 80 + 4, 40 + 8, { ...layout, colStride: 80 }),
      { row: 0, col: 1 },
    );
  });
});

describe("layoutFromSampleCell", () => {
  it("recovers originX from a measured day cell", () => {
    const layout = layoutFromSampleCell({
      containerLeft: 10,
      containerTop: 20,
      scrollLeft: 80,
      scrollTop: 0,
      headerHeight: 48,
      cellLeft: 10 + 200 + 52 * 3 - 80,
      cellWidth: 52,
      cellHeight: 36,
      cellCol: 3,
      rowCount: 20,
      colCount: 12,
    });
    assert.equal(layout.originX, 200);
    assert.equal(layout.rowHeight, 36);
    assert.equal(layout.colStride, 52);
  });
});
