"use client";

import type { ReactNode } from "react";
import { MetricTile } from "@/components/ui/metric-tile";
import { LAYOUT } from "@/components/app/layout-spacing";
import { cn } from "@/lib/utils";
import {
  trackingCommandAsideClass,
  trackingCommandGridClass,
  trackingCommandMapSectionClass,
  trackingCommandShellClass,
  trackingMapInnerFillClass,
  trackingMapStageFillParentClass,
} from "./tracking-command-layout";

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
  const hasFooter = Boolean(footer);

  return (
    <div className={trackingCommandShellClass({ fullscreen: Boolean(fullscreen), hasFooter })}>
      <div
        className={cn(
          trackingCommandGridClass({ fullscreen: Boolean(fullscreen) }),
          className,
        )}
      >
        <aside className={trackingCommandAsideClass({ fullscreen: Boolean(fullscreen), hasFooter })}>
          {left}
        </aside>
        <section
          className={trackingCommandMapSectionClass({
            fullscreen: Boolean(fullscreen),
            hasFooter,
          })}
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
      <div className={cn("relative", mapHeightClass)}>{children}</div>
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
  const resolvedMapHeight = fullscreen
    ? (mapHeightClass ?? "min-h-0 h-full flex-1")
    : fillParent
      ? trackingMapInnerFillClass()
      : footer
        ? aboveFoldHeight
        : (mapHeightClass ?? aboveFoldHeight);

  return (
    <div
      className={cn(
        "flex flex-col",
        LAYOUT.panelGap,
        fullscreen && "h-full min-h-0",
        fillParent && !fullscreen && trackingMapStageFillParentClass(),
        !fullscreen && !fillParent && !footer && aboveFoldHeight,
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
