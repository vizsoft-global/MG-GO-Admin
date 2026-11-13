import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColumnVisibilityCheck } from "./column-visibility-check";

function render(props: Partial<Parameters<typeof ColumnVisibilityCheck>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ColumnVisibilityCheck, {
      checked: true,
      onToggle: () => undefined,
      label: "Hide column Name",
      ...props,
    }),
  );
}

describe("column visibility checkbox", () => {
  it("paints a checked column as a solid emerald square", () => {
    const html = render({ checked: true });
    assert.match(html, /bg-emerald-500/);
    assert.match(html, /border-emerald-500/);
    assert.match(html, /text-white/);
    assert.match(html, /role="checkbox"/);
    assert.match(html, /aria-checked="true"/);
  });

  it("paints a hidden column as an empty bordered square, not a gap", () => {
    const html = render({ checked: false });
    assert.match(html, /aria-checked="false"/);
    assert.match(html, /border-muted-foreground\/60/);
    assert.match(html, /bg-transparent/);
    // The tick is still in the DOM but transparent: the box stays the same size
    // whether it is ticked or not, so rows do not shift when one is toggled.
    assert.match(html, /text-transparent/);
    assert.doesNotMatch(html, /bg-emerald-500/);
  });

  it("is a 16px rounded box by default and 20px in the payroll panels", () => {
    assert.match(render(), /size-4/);
    assert.match(render(), /rounded-\[4px\]/);
    assert.match(render({ size: "md" }), /size-5/);
  });

  it("keeps a required column green but unclickable", () => {
    const html = render({ checked: true, locked: true });
    assert.match(html, /bg-emerald-500/, "a locked column is still visibly on");
    assert.match(html, /disabled/);
    assert.match(html, /aria-disabled="true"/);
    assert.match(html, /cursor-not-allowed/);
    assert.match(html, /opacity-70/);
  });

  it("does not disable a normal column", () => {
    const html = render({ checked: true });
    assert.doesNotMatch(html, /disabled/);
    assert.doesNotMatch(html, /aria-disabled/);
    assert.match(html, /cursor-pointer/);
  });

  it("labels the control for a screen reader", () => {
    assert.match(render({ label: "Hide column Phone" }), /aria-label="Hide column Phone"/);
  });
});

describe("column panels use the shared square checkbox", () => {
  const PANELS = [
    "src/components/app/app-table-column-picker.tsx",
    "src/components/app/column-order-menu.tsx",
  ];

  for (const path of PANELS) {
    it(path, () => {
      const source = readFileSync(path, "utf8");
      assert.match(source, /ColumnVisibilityCheck/, `${path} does not draw the shared checkbox`);
    });
  }

  it("the shared picker no longer relies on a menu item's floating indicator", () => {
    const source = readFileSync("src/components/app/app-table-column-picker.tsx", "utf8");
    assert.doesNotMatch(
      source,
      /DropdownMenuCheckboxItem/,
      "a menu indicator paints the tick on the trailing edge and nothing when hidden",
    );
  });

  it("keeps the handle, the tick and the label in that order", () => {
    const source = readFileSync("src/components/app/app-table-column-picker.tsx", "utf8");
    const handleAt = source.indexOf("GripVertical");
    const checkAt = source.indexOf("<ColumnVisibilityCheck");
    const labelAt = source.indexOf("option.label");
    assert.ok(handleAt > 0 && checkAt > handleAt, "the tick must follow the drag handle");
    assert.ok(labelAt > checkAt, "the label must follow the tick");
  });
});
