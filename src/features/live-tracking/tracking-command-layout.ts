import { LAYOUT } from "@/components/app/layout-spacing";
import { cn } from "@/lib/utils";

/** Driver-row region: no extra stacked cap — the aside row is already height-capped. */
export const DRIVER_LIST_STACKED_MAX = "max-xl:min-h-0";

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
        "max-xl:overflow-hidden",
      ),
  );
}

export function trackingCommandGridClass(opts: {
  fullscreen: boolean;
  hasFooter?: boolean;
}): string {
  return cn(
    "grid min-h-0",
    LAYOUT.panelGap,
    "max-xl:grid-cols-1",
    opts.fullscreen
      ? "h-full flex-1 grid-rows-1 xl:grid-cols-[minmax(240px,1fr)_minmax(0,4fr)]"
      : "xl:flex-1 xl:grid-cols-[minmax(240px,1fr)_minmax(0,4fr)] xl:items-stretch",
    !opts.fullscreen &&
      opts.hasFooter &&
      "max-xl:flex-1 max-xl:min-h-0 max-xl:grid-rows-[minmax(0,240px)_minmax(200px,1fr)]",
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
    !opts.fullscreen && opts.hasFooter && "max-xl:min-h-0 max-xl:overflow-hidden",
    !opts.fullscreen &&
      !opts.hasFooter &&
      cn(LAYOUT.mapAboveFoldHeight, LAYOUT.mapAboveFoldMin, "max-xl:h-auto max-xl:min-h-0"),
  );
}

/**
 * Stacked (< xl) map fills the remaining grid row. Literals only —
 * Tailwind will not emit CSS for `max-xl:` + string-replaced tokens.
 */
const STACKED_MAP_IN_VIEWPORT = "max-xl:h-full max-xl:min-h-[200px]";

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
      cn("xl:h-full xl:min-h-0", STACKED_MAP_IN_VIEWPORT),
  );
}

/** Fill the grid map cell at every breakpoint once the parent has a real height. */
export function trackingMapStageFillParentClass(): string {
  return cn("xl:min-h-0 xl:flex-1 xl:h-full", STACKED_MAP_IN_VIEWPORT);
}

export function trackingMapInnerFillClass(): string {
  return cn("h-full flex-1 xl:min-h-0", "max-xl:min-h-[200px]");
}

export function trackingMapFrameFillClass(): string {
  return cn(trackingMapInnerFillClass());
}
