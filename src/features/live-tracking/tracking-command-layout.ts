import { LAYOUT } from "@/components/app/layout-spacing";
import { cn } from "@/lib/utils";

/** Driver-row region cap when the command layout stacks (viewport < xl / 1280px). */
export const DRIVER_LIST_STACKED_MAX = "max-xl:max-h-[420px]";

export function trackingCommandShellClass(opts: {
  fullscreen: boolean;
  hasFooter: boolean;
}): string {
  return cn(
    "flex min-h-0 flex-col",
    LAYOUT.panelGap,
    opts.fullscreen && "h-full",
    !opts.fullscreen &&
      opts.hasFooter &&
      cn(
        LAYOUT.commandViewportHeight,
        LAYOUT.commandViewportMin,
        "max-xl:h-auto max-xl:min-h-0",
      ),
  );
}

export function trackingCommandGridClass(opts: { fullscreen: boolean }): string {
  return cn(
    "grid min-h-0",
    LAYOUT.panelGap,
    "max-xl:grid-cols-1",
    opts.fullscreen
      ? "h-full flex-1 grid-rows-1 xl:grid-cols-[minmax(240px,1fr)_minmax(0,4fr)]"
      : "xl:flex-1 xl:grid-cols-[minmax(240px,1fr)_minmax(0,4fr)] xl:items-stretch",
  );
}

export function trackingCommandAsideClass(opts: {
  fullscreen: boolean;
  hasFooter: boolean;
}): string {
  return cn(
    "flex min-h-0 flex-col",
    LAYOUT.panelGap,
    opts.fullscreen && "h-full min-h-0 overflow-hidden",
    !opts.fullscreen && "xl:h-full xl:overflow-hidden",
    !opts.fullscreen && "max-xl:h-auto max-xl:max-h-none max-xl:overflow-visible",
    !opts.fullscreen && !opts.hasFooter && cn(LAYOUT.mapAboveFoldHeight, LAYOUT.mapAboveFoldMin, "max-xl:h-auto max-xl:min-h-0"),
  );
}

/** Stacked (< xl) map height — never pair with unscoped `min-h-0` on the same node. */
function stackedMapAboveFoldClass(): string {
  return cn(
    LAYOUT.mapAboveFoldHeight.replace(/^h-/, "max-xl:h-"),
    LAYOUT.mapAboveFoldMin.replace(/^min-h/, "max-xl:min-h"),
  );
}

export function trackingCommandMapSectionClass(opts: {
  fullscreen: boolean;
  hasFooter: boolean;
}): string {
  return cn(
    "flex flex-col",
    LAYOUT.panelGap,
    opts.fullscreen && "h-full min-h-0",
    !opts.fullscreen &&
      !opts.hasFooter &&
      cn(LAYOUT.mapAboveFoldHeight, LAYOUT.mapAboveFoldMin),
    !opts.fullscreen &&
      opts.hasFooter &&
      cn("xl:h-full xl:min-h-0", stackedMapAboveFoldClass()),
  );
}

/** Fill the xl+ grid cell; below xl use a real above-fold height (not % of auto). */
export function trackingMapStageFillParentClass(): string {
  return cn("xl:min-h-0 xl:flex-1 xl:h-full", stackedMapAboveFoldClass());
}

export function trackingMapInnerFillClass(): string {
  return cn("h-full flex-1 xl:min-h-0", LAYOUT.mapAboveFoldMin.replace(/^min-h/, "max-xl:min-h"));
}

export function trackingMapFrameFillClass(): string {
  return cn(trackingMapInnerFillClass(), "max-xl:shrink-0");
}
