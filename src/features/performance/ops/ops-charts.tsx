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
import { opsBarColorForKey } from "../performance-ops-formulas";
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
        "flex h-full min-h-[220px] flex-col rounded-xl border border-border bg-card p-4 shadow-sm",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        {onExport ? (
          <button
            type="button"
            onClick={onExport}
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
    <div className="rounded-md border border-border bg-card px-2.5 py-2 text-[11px] shadow-sm">
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
              className="fill-foreground text-[10px]"
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
                    fill={opsBarColorForKey(String(row[xKey] ?? index))}
                  />
                ))
              : null}
            <LabelList
              dataKey={s.key}
              position={layout === "horizontal" ? "right" : "top"}
              className="fill-foreground text-[10px]"
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
