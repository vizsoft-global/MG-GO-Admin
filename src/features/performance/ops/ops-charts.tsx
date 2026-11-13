"use client";

import type { ReactNode } from "react";
import { Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { opsRampStepColor } from "../performance-ops-formulas";
import { AppEmptyState } from "@/components/app";
import {
  formatInt,
  formatOpsMetricValue,
  type OpsTooltipMetric,
} from "../performance-ops-format";
import { cn } from "@/lib/utils";

function formatOpsTooltipNumber(
  value: number | string | null | undefined,
  metric?: OpsTooltipMetric,
): string {
  if (metric) return formatOpsMetricValue(metric, value);
  if (value == null || value === "") return "—";
  if (typeof value === "string" && !Number.isFinite(Number(value))) return value;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return formatInt(n);
  return n.toFixed(1);
}

const TIP_KEYS = ["id", "nationality", "store", "vehicle", "zone", "source"] as const;

export function OpsChartCard({
  title,
  onExport,
  exportLabel,
  empty,
  emptyTitle,
  children,
  className,
}: {
  title: string;
  onExport?: () => void;
  exportLabel?: string;
  empty?: boolean;
  emptyTitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "ops-card flex h-full min-h-[220px] flex-col rounded-xl border border-border bg-card p-4 shadow-sm",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        {onExport ? (
          <button
            type="button"
            onClick={onExport}
            data-ops-csv
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-primary/10"
          >
            <Download className="size-3" />
            {exportLabel ?? "CSV"}
          </button>
        ) : null}
      </div>
      {empty ? (
        <AppEmptyState title={emptyTitle ?? "—"} />
      ) : (
        <div className="min-h-0 flex-1">{children}</div>
      )}
    </div>
  );
}

export function OpsTooltip({
  active,
  payload,
  label,
  extra,
  metric,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string;
  extra?: ReactNode;
  metric?: OpsTooltipMetric;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold">{label}</p>
      {payload.map((p) => (
        <p key={String(p.name)} style={{ color: p.color }}>
          {p.name}: {formatOpsTooltipNumber(p.value, metric)}
        </p>
      ))}
      {extra}
    </div>
  );
}

export function OpsLineChart({
  data,
  xKey,
  series,
  metric,
}: {
  data: Array<Record<string, string | number | null>>;
  xKey: string;
  series: Array<{ key: string; color: string; name: string }>;
  metric?: OpsTooltipMetric;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 22, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey={xKey} tick={{ fontSize: 10 }} interval={0} />
        <YAxis tick={{ fontSize: 10 }} width={40} />
        <Tooltip content={<OpsTooltip metric={metric} />} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          >
            <LabelList
              dataKey={s.key}
              position="top"
              className="fill-foreground text-xs"
              formatter={(value) =>
                formatOpsTooltipNumber(value as number | string | null, metric)
              }
            />
          </Line>
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function opsChartTitle(
  t: (key: string, values?: Record<string, string>) => string,
  kind: "trend" | "vehicle" | "zone" | "partner" | "nationality" | "company",
  metricLabel: string,
): string {
  return t(`chartTitle.${kind}`, { metric: metricLabel });
}

export function OpsBarChart({
  data,
  xKey,
  series,
  layout = "vertical",
  metric,
  colorByCategory = false,
}: {
  data: Array<Record<string, string | number | null>>;
  xKey: string;
  series: Array<{ key: string; color: string; name: string }>;
  layout?: "vertical" | "horizontal";
  metric?: OpsTooltipMetric;
  colorByCategory?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={data}
        layout={layout === "horizontal" ? "vertical" : "horizontal"}
        margin={{
          top: layout === "horizontal" ? 8 : 22,
          right: layout === "horizontal" ? 36 : 16,
          left: 8,
          bottom: 4,
        }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        {layout === "horizontal" ? (
          <>
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey={xKey} tick={{ fontSize: 10 }} width={88} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} interval={0} />
            <YAxis tick={{ fontSize: 10 }} width={40} />
          </>
        )}
        <Tooltip
          content={(props) => {
            const row = props.payload?.[0]?.payload as
              | Record<string, string | number | null>
              | undefined;
            const extra = row
              ? TIP_KEYS.filter((k) => row[k] != null && String(row[k]).trim() !== "").map(
                  (k) => (
                    <p key={k} className="text-muted-foreground">
                      {k === "store" ? "Restaurant" : k}: {String(row[k])}
                    </p>
                  ),
                )
              : null;
            return (
              <OpsTooltip
                active={props.active}
                payload={props.payload?.map((p) => {
                  const raw = Array.isArray(p.value) ? p.value[0] : p.value;
                  return {
                    name: p.name == null ? undefined : String(p.name),
                    value:
                      typeof raw === "number" || typeof raw === "string" ? raw : undefined,
                    color: p.color,
                  };
                })}
                label={typeof props.label === "string" || typeof props.label === "number" ? String(props.label) : undefined}
                extra={extra}
                metric={metric}
              />
            );
          }}
        />
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={s.color}
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          >
            {colorByCategory
              ? data.map((row, index) => (
                  <Cell
                    key={`${s.key}-${index}`}
                    fill={opsRampStepColor(index, data.length)}
                  />
                ))
              : null}
            <LabelList
              dataKey={s.key}
              position={layout === "horizontal" ? "right" : "top"}
              className="fill-foreground text-xs"
              formatter={(value) =>
                formatOpsTooltipNumber(value as number | string | null, metric)
              }
            />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * A ranked horizontal bar list — the reference dashboard's primary chart shape.
 *
 * Name on the start edge, bar, value on the end edge, darkest bar at the top.
 * Deliberately CSS rather than recharts: the reference draws exactly this, and a
 * div bar is cheaper and prints the value beside the bar rather than inside a
 * tooltip. `opsRampStepColor` is what makes the darkness mean rank.
 */
export function OpsRankedBars({
  rows,
  format,
  className,
}: {
  rows: ReadonlyArray<{ key: string; label: string; value: number }>;
  format: (value: number) => string;
  className?: string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0.0001);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {rows.map((row, index) => (
        <div key={`${row.key}-${index}`} className="flex items-center gap-2">
          <span
            className="w-[35%] shrink-0 truncate text-end text-[11px] text-muted-foreground"
            title={row.label}
          >
            {row.label}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <i
              className="block h-3 rounded-[2px]"
              style={{
                width: `${Math.max(1.5, (row.value / max) * 88)}%`,
                background: opsRampStepColor(index, rows.length),
              }}
            />
            <u className="shrink-0 text-[11px] font-semibold not-italic tabular-nums">
              {format(row.value)}
            </u>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * A donut — the reference dashboard's chart for a small share-of-total split.
 *
 * Hand-drawn SVG with `stroke-dasharray` on one circle per slice, which keeps the
 * arc geometry exact at any size and needs no chart library. Percentages are
 * printed inside the ring for the slices wide enough to hold a label.
 */
export function OpsDonut({
  rows,
  format,
  className,
}: {
  rows: ReadonlyArray<{ key: string; label: string; value: number }>;
  format: (value: number) => string;
  className?: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const safeTotal = total > 0 ? total : 1;
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  /**
   * Accumulated start offset per slice, computed up front.
   *
   * A running `offset` mutated inside the `.map` is flagged by the React
   * compiler as a post-render assignment; deriving the array first keeps the
   * render pure and the arc geometry identical.
   */
  const slices = rows.map((row, index) => {
    const dash = (row.value / safeTotal) * circumference;
    const start = rows
      .slice(0, index)
      .reduce((sum, previous) => sum + (previous.value / safeTotal) * circumference, 0);
    return { row, dash, start };
  });

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div className="flex flex-wrap items-center justify-center gap-3 text-[10.5px] text-muted-foreground">
        {rows.map((row, index) => (
          <span key={`legend-${row.key}`} className="inline-flex items-center gap-1">
            <i
              className="inline-block size-2 rounded-full"
              style={{ background: opsRampStepColor(index, rows.length) }}
            />
            {row.label} · {format(row.value)}
          </span>
        ))}
      </div>
      <svg viewBox="0 0 160 160" className="size-[150px]" role="img" aria-label="distribution">
        <circle cx="80" cy="80" r={radius} fill="none" stroke="var(--border)" strokeWidth="18" />
        {slices.map((slice, index) => (
          <circle
            key={slice.row.key}
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke={opsRampStepColor(index, rows.length)}
            strokeWidth="18"
            strokeDasharray={`${slice.dash} ${circumference - slice.dash}`}
            strokeDashoffset={-slice.start}
            // Start at 12 o'clock, not 3.
            transform="rotate(-90 80 80)"
          />
        ))}
        <text
          x="80"
          y="84"
          textAnchor="middle"
          className="fill-foreground text-[13px] font-semibold tabular-nums"
        >
          {format(total)}
        </text>
      </svg>
    </div>
  );
}

/**
 * Vertical columns — the reference dashboard's chart for a small, ordered set
 * (client, vehicle, distribution buckets).
 *
 * Value printed above each column and the category label below, which is what
 * the reference does; a tooltip-only bar loses the number on a printed screen.
 */
export function OpsVBars({
  rows,
  format,
  colors,
  className,
}: {
  rows: ReadonlyArray<{ key: string; label: string; value: number }>;
  format: (value: number) => string;
  /** Explicit palette, for a chart where colour has its own meaning (RAG bands). */
  colors?: readonly string[];
  className?: string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0.0001);
  return (
    <div className={cn("flex items-end gap-2", className)} style={{ minHeight: 150 }}>
      {rows.map((row, index) => (
        <div key={`${row.key}-${index}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
          <span className="mb-1 text-[10.5px] font-bold tabular-nums">{format(row.value)}</span>
          <i
            className="block w-full max-w-[52px] rounded-[2px]"
            style={{
              height: `${Math.max(3, (row.value / max) * 80)}%`,
              background: colors
                ? (colors[index] ?? colors[colors.length - 1] ?? "var(--ops-c3)")
                : opsRampStepColor(index, rows.length),
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Category labels under an `OpsVBars` row, aligned to the same flex tracks. */
export function OpsVBarsLabels({
  rows,
  className,
}: {
  rows: ReadonlyArray<{ key: string; label: string }>;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-2", className)}>
      {rows.map((row, index) => (
        <span
          key={`${row.key}-label-${index}`}
          className="min-w-0 flex-1 truncate text-center text-[10px] leading-tight text-muted-foreground"
          title={row.label}
        >
          {row.label}
        </span>
      ))}
    </div>
  );
}

/** Good → bad ramp, for a distribution chart where the band itself has a verdict. */
export const OPS_BAND_COLORS = [
  "#1e8449",
  "#58d68d",
  "#f1c40f",
  "#e8713a",
  "#e03127",
] as const;

export function OpsKpiDelta({
  text,
  tone,
}: {
  text: string;
  tone: "up" | "down" | "flat";
}) {
  if (!text) return null;
  return (
    <span
      className={cn(
        "tabular-nums",
        tone === "up" && "text-emerald-700",
        tone === "down" && "text-destructive",
      )}
    >
      {text}
    </span>
  );
}
