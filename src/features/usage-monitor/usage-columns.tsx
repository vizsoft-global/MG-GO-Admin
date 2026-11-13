"use client";

import { useState } from "react";

import type { UsagePoint } from "./usage-forecast";

/**
 * One measure over time as thin columns on a shared baseline.
 *
 * One series, one hue, so there is no legend: the card title names it. The
 * readout above the plot is the hover layer — it shows the peak until a column
 * is pointed at, then that column's time and value.
 */
export function UsageColumns({
  points,
  formatValue,
  formatTime,
  peakLabel,
  emptyLabel,
}: {
  points: readonly UsagePoint[];
  formatValue: (value: number) => string;
  formatTime: (ms: number) => string;
  peakLabel: string;
  emptyLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  const peak = points.reduce((max, point) => Math.max(max, point.v), 0);
  if (points.length === 0 || peak <= 0) {
    return <p className="py-6 text-center text-xs text-[var(--text-muted)]">{emptyLabel}</p>;
  }

  const peakIndex = points.findIndex((point) => point.v === peak);
  const shown = active != null ? points[active] : points[peakIndex];
  const first = points[0]!;
  const middle = points[Math.floor(points.length / 2)]!;
  const last = points[points.length - 1]!;

  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-baseline justify-between gap-2 text-xs text-[var(--text-secondary)]">
        <span>
          {active != null ? formatTime(shown!.t) : peakLabel}
          {active == null ? ` · ${formatTime(shown!.t)}` : ""}
        </span>
        <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
          {formatValue(shown!.v)}
        </span>
      </p>
      <div
        className="flex h-28 items-end gap-[2px] border-b border-[var(--border-default)]"
        onMouseLeave={() => setActive(null)}
        role="img"
        aria-label={`${peakLabel}: ${formatValue(peak)}`}
      >
        {points.map((point, index) => (
          <div
            key={point.t}
            className="flex h-full min-w-0 flex-1 items-end"
            onMouseEnter={() => setActive(index)}
          >
            <div
              className={
                active === index
                  ? "w-full rounded-t-[2px] bg-[var(--text-primary)]"
                  : "w-full rounded-t-[2px] bg-[var(--selected-navy)]"
              }
              style={{ height: point.v > 0 ? `${Math.max(2, (point.v / peak) * 100)}%` : "0%" }}
            />
          </div>
        ))}
      </div>
      <p className="flex justify-between text-[10px] tabular-nums text-[var(--text-muted)]">
        <span>{formatTime(first.t)}</span>
        <span>{formatTime(middle.t)}</span>
        <span>{formatTime(last.t)}</span>
      </p>
    </div>
  );
}
