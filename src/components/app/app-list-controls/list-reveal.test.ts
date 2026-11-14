import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { LIST_PAGE_SIZE, buildGroupSections } from "./list-page";

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `r${index}` }));
const base = { grouped: false, openKeys: new Set<string>(), groupPage: {}, flatPage: 0 };

describe("an ungrouped list that shows more rows as it is scrolled", () => {
  it("shows the first batch, no pager, and says more is waiting", () => {
    const built = buildGroupSections({
      ...base,
      groups: [{ key: "all", label: "", rows: rows(500) }],
      totalOverride: 977,
      flatReveal: LIST_PAGE_SIZE,
    });
    assert.equal(built.sections[0]?.visibleRows.length, LIST_PAGE_SIZE);
    assert.equal(built.flatPager, null);
    assert.equal(built.flatHasMore, true);
    // Select-all still means every row held, not only the ones drawn.
    assert.equal(built.scopeRows.length, 500);
  });

  it("keeps the rows from the top as the count grows, in order", () => {
    const built = buildGroupSections({
      ...base,
      groups: [{ key: "all", label: "", rows: rows(500) }],
      totalOverride: 977,
      flatReveal: LIST_PAGE_SIZE * 3,
    });
    const shown = built.sections[0]?.visibleRows ?? [];
    assert.equal(shown.length, LIST_PAGE_SIZE * 3);
    assert.equal(shown[0]?.id, "r0");
    assert.equal(shown.at(-1)?.id, `r${LIST_PAGE_SIZE * 3 - 1}`);
  });

  it("still has more while the server holds rows the browser does not", () => {
    const built = buildGroupSections({
      ...base,
      groups: [{ key: "all", label: "", rows: rows(500) }],
      totalOverride: 977,
      flatReveal: 560,
    });
    assert.equal(built.sections[0]?.visibleRows.length, 500);
    assert.equal(built.flatHasMore, true);
  });

  it("has nothing more once every row is shown", () => {
    const built = buildGroupSections({
      ...base,
      groups: [{ key: "all", label: "", rows: rows(120) }],
      flatReveal: 160,
    });
    assert.equal(built.sections[0]?.visibleRows.length, 120);
    assert.equal(built.flatHasMore, false);
  });

  it("leaves the pager in place for a list that did not ask for it", () => {
    const built = buildGroupSections({ ...base, groups: [{ key: "all", label: "", rows: rows(500) }] });
    assert.deepEqual(built.flatPager, { page: 0, total: 500 });
    assert.equal(built.sections[0]?.visibleRows.length, LIST_PAGE_SIZE);
    assert.equal(built.flatHasMore, false);
  });

  it("is what Employees uses, in a table sized to the screen", () => {
    const shell = readFileSync(new URL("../../../features/drivers/drivers-page-shell.tsx", import.meta.url), "utf8");
    assert.match(shell, /\{ reveal: true \},/);
    assert.match(shell, /toolbar=\{listToolbar\}\s+fitViewport/);
    const fit = readFileSync(new URL("../fit-viewport.tsx", import.meta.url), "utf8");
    assert.match(fit, /Math\.max\(MIN_HEIGHT_PX, Math\.floor\(windowHeight - top - gutter\)\)/);
  });
});
