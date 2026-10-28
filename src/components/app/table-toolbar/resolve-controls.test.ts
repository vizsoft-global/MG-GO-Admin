import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveToolbarControls } from "./resolve-controls";
import type { TableToolbarColumn, TableToolbarConfig } from "./toolbar-config";

const cols = (n: number, categorical = false): TableToolbarColumn[] =>
  Array.from({ length: n }, (_, index) => ({
    id: `c${index}`,
    label: `C${index}`,
    locked: index < 2,
    categorical: categorical && index === 2,
  }));

function config(partial: Partial<TableToolbarConfig> & Pick<TableToolbarConfig, "columns" | "rowKind">): TableToolbarConfig {
  return {
    tableId: "t",
    entity: "rows",
    ...partial,
  };
}

describe("resolveToolbarControls", () => {
  it("hides search on a fixed table under 10 rows", () => {
    const resolved = resolveToolbarControls(
      config({ columns: cols(6, true), rowKind: "fixed", fixedRows: 6, entityList: true }),
    );
    assert.equal(resolved?.search, false);
    assert.equal(resolved?.groupBy, true);
    assert.equal(resolved?.grid, true);
    assert.equal(resolved?.columns, true);
  });

  it("hides group by on aggregates and on tables with no categorical column", () => {
    const aggregate = resolveToolbarControls(
      config({ columns: cols(6, true), rowKind: "aggregate" }),
    );
    assert.equal(aggregate?.groupBy, false);
    assert.equal(aggregate?.search, true);
    const plain = resolveToolbarControls(
      config({ columns: cols(6, false), rowKind: "dynamic" }),
    );
    assert.equal(plain?.groupBy, false);
  });

  it("shows the grid toggle only on entity lists", () => {
    const list = resolveToolbarControls(
      config({ columns: cols(6, true), rowKind: "dynamic", entityList: true }),
    );
    assert.equal(list?.grid, true);
    const other = resolveToolbarControls(
      config({ columns: cols(6, true), rowKind: "dynamic" }),
    );
    assert.equal(other?.grid, false);
  });

  it("hides columns at 4 or fewer", () => {
    const resolved = resolveToolbarControls(
      config({ columns: cols(4, true), rowKind: "dynamic", entityList: true }),
    );
    assert.equal(resolved?.columns, false);
    assert.ok(resolved);
  });

  it("returns null when every control is hidden", () => {
    const resolved = resolveToolbarControls(
      config({ columns: cols(3), rowKind: "fixed", fixedRows: 4 }),
    );
    assert.equal(resolved, null);
  });

  it("keeps export and add when the page already has those actions", () => {
    const resolved = resolveToolbarControls(
      config({
        columns: cols(3),
        rowKind: "fixed",
        fixedRows: 4,
        exportAction: () => undefined,
        addAction: () => undefined,
      }),
    );
    assert.equal(resolved?.export, true);
    assert.equal(resolved?.add, true);
    assert.equal(resolved?.search, false);
  });
});
