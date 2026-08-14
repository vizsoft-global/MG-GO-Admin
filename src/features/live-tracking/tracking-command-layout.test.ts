import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRIVER_LIST_STACKED_MAX,
  trackingCommandAsideClass,
  trackingCommandGridClass,
  trackingCommandMapSectionClass,
  trackingCommandShellClass,
  trackingMapFrameFillClass,
  trackingMapInnerFillClass,
  trackingMapStageFillParentClass,
} from "./tracking-command-layout";

function tokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

describe("TrackingCommandLayout stacked (< xl) classes", () => {
  it("locks the stacked Live shell to the viewport so the map is on-screen", () => {
    const shell = trackingCommandShellClass({ fullscreen: false, hasFooter: true });
    assert.match(shell, /h-\[calc\(100dvh-1\.5rem\)\]/);
    assert.match(shell, /max-xl:overflow-hidden/);
    assert.doesNotMatch(shell, /max-xl:h-auto/);
  });

  it("reserves a map row under a height-capped fleet column", () => {
    const grid = trackingCommandGridClass({ fullscreen: false, hasFooter: true });
    assert.match(grid, /max-xl:flex-1/);
    assert.match(grid, /max-xl:min-h-0/);
    assert.match(grid, /max-xl:grid-rows-\[minmax\(0,240px\)_minmax\(200px,1fr\)\]/);
  });

  it("scrolls the driver list inside a capped aside instead of growing the page", () => {
    const aside = trackingCommandAsideClass({ fullscreen: false, hasFooter: true });
    assert.match(aside, /max-xl:overflow-hidden/);
    assert.match(aside, /max-xl:min-h-0/);
    assert.doesNotMatch(aside, /max-xl:overflow-visible/);
    assert.doesNotMatch(aside, /max-xl:max-h-\[420px\]/);
    assert.equal(DRIVER_LIST_STACKED_MAX, "max-xl:min-h-0");
  });

  it("fills the remaining stacked row instead of adding a second viewport of map", () => {
    const map = trackingCommandMapSectionClass({ fullscreen: false, hasFooter: true });
    assert.match(map, /max-xl:h-full/);
    assert.match(map, /max-xl:min-h-\[200px\]/);
    assert.doesNotMatch(map, /max-xl:h-\[calc\(100dvh-9rem\)\]/);
    assert.doesNotMatch(map, /max-xl:min-h-\[480px\]/);
  });

  it("keeps side-by-side stretch at xl+", () => {
    const map = trackingCommandMapSectionClass({ fullscreen: false, hasFooter: true });
    assert.match(map, /xl:h-full/);
    const aside = trackingCommandAsideClass({ fullscreen: false, hasFooter: true });
    assert.match(aside, /xl:overflow-hidden/);
  });

  it("does not put unscoped min-h-0 on the stacked map section (overrides min-h-[200px])", () => {
    const map = trackingCommandMapSectionClass({ fullscreen: false, hasFooter: true });
    assert.equal(tokens(map).includes("min-h-0"), false);
  });

  it("lets fillParent stage fill the grid map cell", () => {
    const stage = trackingMapStageFillParentClass();
    assert.match(stage, /max-xl:h-full/);
    assert.match(stage, /max-xl:min-h-\[200px\]/);
    assert.match(stage, /xl:h-full/);
    assert.doesNotMatch(stage, /max-xl:h-\[calc\(100dvh-9rem\)\]/);
    assert.equal(tokens(stage).includes("min-h-0"), false);
  });

  it("gives the map surface a stacked floor so the 1fr row cannot collapse it", () => {
    for (const className of [trackingMapInnerFillClass(), trackingMapFrameFillClass()]) {
      assert.match(className, /max-xl:min-h-\[200px\]/);
      assert.match(className, /h-full/);
      assert.doesNotMatch(className, /max-xl:min-h-\[480px\]/);
      assert.equal(tokens(className).includes("min-h-0"), false);
    }
  });

  it("keeps stacked height classes as Tailwind-scannable literals", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("./tracking-command-layout.ts", import.meta.url), "utf8");
    assert.match(src, /max-xl:min-h-\[200px\]/);
    assert.match(src, /max-xl:grid-rows-\[minmax\(0,240px\)_minmax\(200px,1fr\)\]/);
    assert.doesNotMatch(src, /mapAboveFoldHeight\.replace/);
    assert.doesNotMatch(src, /mapAboveFoldMin\.replace/);
  });
});
