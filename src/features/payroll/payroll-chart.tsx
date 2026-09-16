"use client";

import { Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PAYROLL_EFF_BUCKETS, bucketOf, type PayrollEffBucketId } from "./payroll-formulas";
import type { PayrollRiderRow } from "./payroll-types";

export function PayrollDistributionChart({
  riders,
  selected,
  onSelect,
  onExport,
  exportLabel,
  title,
  subtitle,
}: {
  riders: readonly PayrollRiderRow[];
  selected: PayrollEffBucketId | null;
  onSelect: (id: PayrollEffBucketId | null) => void;
  onExport: () => void;
  exportLabel: string;
  title: string;
  subtitle: string;
}) {
  const data = PAYROLL_EFF_BUCKETS.map((b) => ({
    id: b.id,
    label: b.label,
    color: b.color,
    riders: riders.filter((r) => bucketOf(r.efficiency) === b.id).length,
  }));

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-primary/10"
        >
          <Download className="size-3" />
          {exportLabel}
        </button>
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
            onClick={(state) => {
              const raw = state as { activePayload?: Array<{ payload?: { id?: PayrollEffBucketId } }> };
              const id = raw.activePayload?.[0]?.payload?.id;
              if (!id) return;
              onSelect(selected === id ? null : id);
            }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={32} />
            <Tooltip
              cursor={{ fill: "transparent" }}
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const row = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded-md border border-border bg-card px-2.5 py-2 text-[11px] shadow-sm">
                    {row.label}: {row.riders}
                  </div>
                );
              }}
            />
            <Bar dataKey="riders" radius={[5, 5, 0, 0]} maxBarSize={70} cursor="pointer">
              {data.map((row) => (
                <Cell
                  key={row.id}
                  fill={row.color}
                  fillOpacity={selected == null || selected === row.id ? 1 : 0.28}
                  stroke={selected === row.id ? "var(--foreground)" : "transparent"}
                  strokeWidth={selected === row.id ? 2 : 0}
                  onClick={() => onSelect(selected === row.id ? null : row.id)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
