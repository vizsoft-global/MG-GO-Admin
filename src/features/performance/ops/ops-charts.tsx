"use client";

import type { ReactNode } from "react";
import { Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppEmptyState } from "@/components/app";
import { cn } from "@/lib/utils";

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
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string;
  extra?: ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-2 text-[11px] shadow-sm">
      <p className="mb-1 font-semibold">{label}</p>
      {payload.map((p) => (
        <p key={String(p.name)} style={{ color: p.color }}>
          {p.name}: {p.value ?? "—"}
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
}: {
  data: Array<Record<string, string | number | null>>;
  xKey: string;
  series: Array<{ key: string; color: string; name: string }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} width={36} />
        <Tooltip content={<OpsTooltip />} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function OpsBarChart({
  data,
  xKey,
  series,
  layout = "vertical",
}: {
  data: Array<Record<string, string | number | null>>;
  xKey: string;
  series: Array<{ key: string; color: string; name: string }>;
  layout?: "vertical" | "horizontal";
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart
        data={data}
        layout={layout === "horizontal" ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        {layout === "horizontal" ? (
          <>
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey={xKey} tick={{ fontSize: 10 }} width={72} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={36} />
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
                      {k}: {String(row[k])}
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
          />
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
