import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COLUMN_LAYOUT_PREFIX,
  canMoveColumn,
  columnLayoutKey,
  defaultColumnLayout,
  isColumnVisible,
  moveColumn,
  parseColumnLayout,
  reorderColumn,
  resolveColumnLayout,
  serializeColumnLayout,
  toggleColumnVisibility,
  type ColumnLayout,
} from "./column-layout";

const IDS = ["mgId", "name", "zone", "status", "joined"] as const;

function layout(order: readonly string[], visible?: readonly string[]): ColumnLayout {
  return { order, visible: visible ?? order };
}

describe("column layout keys", () => {
  it("is unique per table and versioned", () => {
    assert.equal(columnLayoutKey("esign.sent"), `${COLUMN_LAYOUT_PREFIX}:esign.sent`);
    assert.notEqual(columnLayoutKey("a"), columnLayoutKey("b"));
    assert.ok(COLUMN_LAYOUT_PREFIX.endsWith(".v1"), "a shape change needs a new version");
  });
});

describe("default layout", () => {
  it("shows every column in catalogue order", () => {
    const fresh = defaultColumnLayout(IDS);
    assert.deepEqual(fresh.order, [...IDS]);
    assert.deepEqual(fresh.visible, [...IDS]);
    for (const id of IDS) assert.equal(isColumnVisible(fresh, id), true);
  });
});

describe("resolving a saved layout", () => {
  it("keeps the saved order", () => {
    const resolved = resolveColumnLayout(IDS, {
      order: ["status", "name", "mgId"],
      visible: ["status"],
    });
    assert.deepEqual(resolved.order, ["status", "name", "mgId", "zone", "joined"]);
    assert.deepEqual(resolved.visible, ["status"]);
  });

  it("drops ids the catalogue no longer has", () => {
    const resolved = resolveColumnLayout(IDS, { order: ["gone", "name"], visible: ["gone", "name"] });
    assert.ok(!resolved.order.includes("gone"));
    assert.deepEqual(resolved.visible, ["name"]);
  });

  it("appends a column added after the layout was saved", () => {
    const resolved = resolveColumnLayout(IDS, { order: ["name"], visible: ["name"] });
    assert.deepEqual(resolved.order, ["name", "mgId", "zone", "status", "joined"]);
  });

  it("treats an unreadable or empty visible list as everything shown", () => {
    assert.deepEqual(resolveColumnLayout(IDS, null).visible, [...IDS]);
    assert.deepEqual(resolveColumnLayout(IDS, { order: [...IDS], visible: [] }).visible, [...IDS]);
    assert.deepEqual(resolveColumnLayout(IDS, { order: [...IDS] }).visible, [...IDS]);
  });

  it("never resolves to zero visible columns", () => {
    const resolved = resolveColumnLayout(IDS, { order: [...IDS], visible: ["nope"] });
    assert.equal(resolved.visible.length, IDS.length);
  });
});

describe("toggling visibility", () => {
  it("hides a ticked column and shows it again", () => {
    const hidden = toggleColumnVisibility(layout(IDS), "zone");
    assert.equal(isColumnVisible(hidden, "zone"), false);
    assert.deepEqual(hidden.order, [...IDS], "hiding must not reorder");

    const shown = toggleColumnVisibility(hidden, "zone");
    assert.equal(isColumnVisible(shown, "zone"), true);
    assert.deepEqual(shown.visible, ["mgId", "name", "zone", "status", "joined"]);
  });

  it("refuses to hide the last visible column", () => {
    const one = layout(IDS, ["name"]);
    assert.deepEqual(toggleColumnVisibility(one, "name").visible, ["name"]);
  });

  it("ignores an id that is not in the table", () => {
    assert.deepEqual(toggleColumnVisibility(layout(IDS), "nope").visible, [...IDS]);
  });
});

describe("moving a column", () => {
  it("swaps one slot up and down", () => {
    assert.deepEqual(moveColumn(layout(IDS), "zone", -1).order, ["mgId", "zone", "name", "status", "joined"]);
    assert.deepEqual(moveColumn(layout(IDS), "zone", 1).order, ["mgId", "name", "status", "zone", "joined"]);
  });

  it("is a no-op at either end", () => {
    assert.deepEqual(moveColumn(layout(IDS), "mgId", -1).order, [...IDS]);
    assert.deepEqual(moveColumn(layout(IDS), "joined", 1).order, [...IDS]);
  });

  it("keeps visibility untouched", () => {
    const hidden = toggleColumnVisibility(layout(IDS), "status");
    assert.deepEqual(moveColumn(hidden, "joined", -1).visible, hidden.visible);
  });

  it("will not move a pinned column", () => {
    assert.deepEqual(moveColumn(layout(IDS), "mgId", 1, ["mgId"]).order, [...IDS]);
    assert.deepEqual(moveColumn(layout(IDS), "name", -1, ["mgId"]).order, [...IDS]);
  });

  it("will not push a pinned column out of its slot", () => {
    assert.deepEqual(moveColumn(layout(IDS), "name", -1, ["mgId"]).order, [...IDS]);
    assert.deepEqual(moveColumn(layout(IDS), "zone", 1, ["mgId"]).order, [
      "mgId",
      "name",
      "status",
      "zone",
      "joined",
    ]);
  });
});

describe("reordering a column", () => {
  it("takes the dropped column's slot", () => {
    assert.deepEqual(reorderColumn(layout(IDS), "joined", "name").order, [
      "mgId",
      "joined",
      "name",
      "zone",
      "status",
    ]);
  });

  it("refuses when either end is pinned", () => {
    assert.deepEqual(reorderColumn(layout(IDS), "mgId", "joined", ["mgId"]).order, [...IDS]);
    assert.deepEqual(reorderColumn(layout(IDS), "joined", "mgId", ["mgId"]).order, [...IDS]);
  });

  it("is a no-op on itself or an unknown id", () => {
    assert.deepEqual(reorderColumn(layout(IDS), "name", "name").order, [...IDS]);
    assert.deepEqual(reorderColumn(layout(IDS), "name", "nope").order, [...IDS]);
  });
});

describe("canMoveColumn", () => {
  it("answers what the arrow should draw", () => {
    assert.equal(canMoveColumn(layout(IDS), "name", -1), true);
    assert.equal(canMoveColumn(layout(IDS), "mgId", -1), false, "top bound");
    assert.equal(canMoveColumn(layout(IDS), "joined", 1), false, "bottom bound");
    assert.equal(canMoveColumn(layout(IDS), "mgId", 1, ["mgId"]), false, "pinned");
    assert.equal(canMoveColumn(layout(IDS), "name", -1, ["mgId"]), false, "pinned neighbour");
    assert.equal(canMoveColumn(layout(IDS), "nope", 1), false);
  });
});

describe("stored form", () => {
  it("round-trips through serialize/parse", () => {
    const value = layout(["name", "mgId", "status"], ["name", "status"]);
    assert.deepEqual(parseColumnLayout(serializeColumnLayout(value)), value);
  });

  it("reads anything unreadable as never arranged", () => {
    assert.equal(parseColumnLayout(null), null);
    assert.equal(parseColumnLayout(""), null);
    assert.equal(parseColumnLayout("not json"), null);
    assert.equal(parseColumnLayout('{"visible":["a"]}'), null, "order is required");
    assert.equal(parseColumnLayout("[]"), null);
    assert.equal(parseColumnLayout('"text"'), null);
  });

  it("ignores non-string entries rather than throwing", () => {
    assert.deepEqual(parseColumnLayout('{"order":["a",2,null,"b"],"visible":["a",3]}'), {
      order: ["a", "b"],
      visible: ["a"],
    });
  });
});
