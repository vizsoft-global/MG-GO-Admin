"use client";

import type { ReactNode } from "react";
import { MetricTile } from "@/components/ui/metric-tile";
import { LAYOUT } from "@/components/app/layout-spacing";
import { cn } from "@/lib/utils";

export function TrackingGlassCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TrackingCommandLayout({
  left,
  center,
  footer,
  className,
  fullscreen,
}: {
  left: ReactNode;
  center: ReactNode;
  footer?: ReactNode;
  className?: string;
  fullscreen?: boolean;
}) {
  const sharedHeight = cn(LAYOUT.mapAboveFoldHeight, LAYOUT.mapAboveFoldMin);
  const hasFooter = Boolean(footer);
  const fullViewport = cn(LAYOUT.commandViewportHeight, LAYOUT.commandViewportMin);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        LAYOUT.panelGap,
        fullscreen && "h-full",
        !fullscreen && hasFooter && cn(fullViewport, "max-xl:h-auto"),
      )}
    >
      <div
        className={cn(
          "grid min-h-0 flex-1",
          LAYOUT.panelGap,
          fullscreen
            ? "h-full grid-rows-1 xl:grid-cols-[minmax(240px,1fr)_minmax(0,4fr)]"
            : cn("xl:grid-cols-[minmax(240px,1fr)_minmax(0,4fr)]", "xl:items-stretch"),
          "max-xl:grid-cols-1",
          className,
        )}
      >
        <aside
          className={cn(
            "flex min-h-0 flex-col overflow-hidden",
            LAYOUT.panelGap,
            !fullscreen && !hasFooter && cn("max-xl:max-h-[420px]", sharedHeight),
            !fullscreen && hasFooter && "max-xl:max-h-[420px]",
            fullscreen && "h-full min-h-0",
          )}
        >
          {left}
        </aside>
        <section
          className={cn(
            "flex min-h-0 flex-col",
            LAYOUT.panelGap,
            fullscreen && "h-full min-h-0",
            !fullscreen && !hasFooter && sharedHeight,
          )}
        >
          {center}
        </section>
      </div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </div>
  );
}

export function TrackingMapFrame({
  children,
  className,
  mapHeightClass = "min-h-[560px] flex-1",
}: {
  children: ReactNode;
  className?: string;
  mapHeightClass?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 flex-col overflow-hidden rounded-xl",
        "border border-border bg-muted/30 shadow-sm dark:border-slate-700/80 dark:bg-slate-950/40",
        className,
      )}
    >
      <div className={cn("relative min-h-0", mapHeightClass)}>{children}</div>
    </div>
  );
}

/** Map capped above the fold with optional footer widgets in normal document flow. */
export function TrackingMapStage({
  children,
  footer,
  mapHeightClass,
  frameClassName,
  fullscreen,
  fillParent,
}: {
  children: ReactNode;
  footer?: ReactNode;
  mapHeightClass?: string;
  frameClassName?: string;
  fullscreen?: boolean;
  /** When true, the stage stretches to fill its parent (used when the layout
   *  already constrains height — e.g. TrackingCommandLayout with a footer). */
  fillParent?: boolean;
}) {
  const aboveFoldHeight = cn(LAYOUT.mapAboveFoldHeight, LAYOUT.mapAboveFoldMin);
  const useExternalHeight = fullscreen || fillParent;
  const resolvedMapHeight = useExternalHeight
    ? (mapHeightClass ?? "min-h-0 h-full flex-1")
    : footer
      ? aboveFoldHeight
      : (mapHeightClass ?? aboveFoldHeight);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        LAYOUT.panelGap,
        fullscreen && "h-full min-h-0",
        fillParent && !fullscreen && "min-h-0 flex-1",
        !useExternalHeight && !footer && aboveFoldHeight,
      )}
    >
      <TrackingMapFrame mapHeightClass={resolvedMapHeight} className={frameClassName}>
        {children}
      </TrackingMapFrame>
      {footer ? (
        <div className="grid shrink-0 gap-2 md:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)]">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function TrackingMetricTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "default" | "success" | "warning" | "danger";
}) {
  const accentClass =
    accent === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : accent === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : accent === "danger"
          ? "text-rose-600 dark:text-rose-400"
          : "text-foreground";

  return (
    <MetricTile
      label={label}
      value={value}
      tone={
        accent === "success"
          ? "success"
          : accent === "warning"
            ? "warning"
            : accent === "danger"
              ? "danger"
              : "neutral"
      }
      hint={hint}
      className={cn("min-h-[90px]", accentClass)}
    />
  );
}
