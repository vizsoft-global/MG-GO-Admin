import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRIVER_LIST_STACKED_MAX,
  trackingCommandAsideClass,
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
  it("lets the page grow instead of leaving a viewport-tall empty band", () => {
    const shell = trackingCommandShellClass({ fullscreen: false, hasFooter: true });
    assert.match(shell, /max-xl:h-auto/);
    assert.match(shell, /max-xl:min-h-0/);
  });

  it("does not cap the whole driver column at 420px so KPIs cannot hide the list", () => {
    const aside = trackingCommandAsideClass({ fullscreen: false, hasFooter: true });
    assert.doesNotMatch(aside, /max-xl:max-h-\[420px\]/);
    assert.match(aside, /max-xl:overflow-visible/);
    assert.equal(DRIVER_LIST_STACKED_MAX, "max-xl:max-h-[420px]");
  });

  it("gives the stacked map a usable above-fold height", () => {
    const map = trackingCommandMapSectionClass({ fullscreen: false, hasFooter: true });
    assert.match(map, /max-xl:min-h-\[480px\]/);
    assert.match(map, /max-xl:h-\[calc\(100dvh-9rem\)\]/);
  });

  it("keeps side-by-side stretch at xl+", () => {
    const map = trackingCommandMapSectionClass({ fullscreen: false, hasFooter: true });
    assert.match(map, /xl:h-full/);
    const aside = trackingCommandAsideClass({ fullscreen: false, hasFooter: true });
    assert.match(aside, /xl:overflow-hidden/);
  });

  it("does not put unscoped min-h-0 on the stacked map section (overrides min-h-[480px])", () => {
    const map = trackingCommandMapSectionClass({ fullscreen: false, hasFooter: true });
    assert.equal(tokens(map).includes("min-h-0"), false);
  });

  it("gives fillParent stage a real stacked height instead of h-full of an auto parent", () => {
    const stage = trackingMapStageFillParentClass();
    assert.match(stage, /max-xl:min-h-\[480px\]/);
    assert.match(stage, /max-xl:h-\[calc\(100dvh-9rem\)\]/);
    assert.match(stage, /xl:h-full/);
    assert.equal(tokens(stage).includes("min-h-0"), false);
  });

  it("gives the map surface itself a stacked min-height so Insights 2-col cannot collapse it", () => {
    for (const className of [trackingMapInnerFillClass(), trackingMapFrameFillClass()]) {
      assert.match(className, /max-xl:min-h-\[480px\]/);
      assert.match(className, /h-full/);
      assert.equal(tokens(className).includes("min-h-0"), false);
    }
  });
});
