"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { cn } from "@/lib/utils";
import { ComparisonHeaderFilter } from "./order-comparison-header-filter";
import { columnFilterValues, type ComparisonColumnFilters } from "./order-comparison-filters";
import {
  diffTint,
  formatPct,
  weekdayShort,
  type ComparisonRider,
} from "./order-comparison-model";

const STICKY = [
  "sticky start-0 z-10 min-w-8 bg-card",
  "sticky start-8 z-10 min-w-[72px] bg-card",
  "sticky start-[104px] z-10 min-w-[140px] bg-card",
  "sticky start-[244px] z-10 min-w-[120px] bg-card",
  "sticky start-[364px] z-10 min-w-12 bg-card",
] as const;

export function ComparisonDayGrid({
  riders,
  days,
  monthLabel,
  filters,
  onFilters,
  labels,
}: {
  riders: ComparisonRider[];
  days: string[];
  monthLabel: string;
  filters: ComparisonColumnFilters;
  onFilters: (next: ComparisonColumnFilters) => void;
  labels: {
    mgId: string;
    name: string;
    restaurant: string;
    month: string;
    days: string;
    search: string;
    all: string;
    clear: string;
    apply: string;
    min: string;
    max: string;
    contains: string;
  };
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const headFilter = (id: string, extra?: string[]) => (
    <ComparisonHeaderFilter
      columnId={id}
      values={extra ?? columnFilterValues(riders, id)}
      filters={filters}
      onApply={onFilters}
      searchPlaceholder={labels.search}
      allLabel={labels.all}
      clearLabel={labels.clear}
      applyLabel={labels.apply}
      minLabel={labels.min}
      maxLabel={labels.max}
      containsLabel={labels.contains}
    />
  );

  return (
    <div className="overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className={cn(TABLE_HEAD_CLASS, STICKY[0], "px-1 py-1")} />
            <th className={cn(TABLE_HEAD_CLASS, STICKY[1], "px-1.5 py-1")}>
              <span className="inline-flex items-center gap-0.5">
                {labels.mgId}
                {headFilter("mgId")}
              </span>
            </th>
            <th className={cn(TABLE_HEAD_CLASS, STICKY[2], "px-1.5 py-1")}>
              <span className="inline-flex items-center gap-0.5">
                {labels.name}
                {headFilter("name")}
              </span>
            </th>
            <th className={cn(TABLE_HEAD_CLASS, STICKY[3], "px-1.5 py-1")}>
              <span className="inline-flex items-center gap-0.5">
                {labels.restaurant}
                {headFilter("restaurant")}
              </span>
            </th>
            <th className={cn(TABLE_HEAD_CLASS, STICKY[4], "px-1.5 py-1 text-center")}>{labels.month}</th>
            <th className={cn(TABLE_HEAD_CLASS, "px-1.5 py-1 text-center")}>
              <span className="inline-flex items-center gap-0.5">
                {labels.days}
                {headFilter("offDays")}
              </span>
            </th>
            {days.map((ymd) => (
              <th key={ymd} className={cn(TABLE_HEAD_CLASS, "min-w-8 px-0.5 py-1 text-center")}>
                <div>{ymd.slice(8)}</div>
                <div className="text-[9px] font-normal text-muted-foreground">{weekdayShort(ymd)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {riders.map((row) => {
            const open = openId === row.mgId;
            return (
              <RiderBlock
                key={row.mgId}
                row={row}
                open={open}
                monthLabel={monthLabel}
                onToggle={() => setOpenId(open ? null : row.mgId)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RiderBlock({
  row,
  open,
  monthLabel,
  onToggle,
}: {
  row: ComparisonRider;
  open: boolean;
  monthLabel: string;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-muted/30" onClick={onToggle}>
        <td className={cn(STICKY[0], "border-b border-border px-1 py-1")}>
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </td>
        <td className={cn(STICKY[1], "border-b border-border px-1.5 py-1 font-medium")}>{row.mgId}</td>
        <td className={cn(STICKY[2], "border-b border-border px-1.5 py-1")}>{row.name || "—"}</td>
        <td className={cn(STICKY[3], "border-b border-border px-1.5 py-1")}>{row.restaurant}</td>
        <td className={cn(STICKY[4], "border-b border-border px-1.5 py-1 text-center text-[10px]")}>{monthLabel}</td>
        <td className="border-b border-border px-1.5 py-1 text-center">{row.offDays}</td>
        {row.diffDays.map((d, i) => {
          const tint = diffTint(d);
          return (
            <td
              key={`${row.mgId}-${i}`}
              className="border-b border-border px-0.5 py-1 text-center font-medium"
              style={tint.bg ? { backgroundColor: tint.bg, color: tint.fg } : undefined}
            >
              {d === 0 ? "" : d > 0 ? `+${d}` : d}
            </td>
          );
        })}
      </tr>
      {open ? (
        <>
          <SubRow label="AM" values={row.amDays} />
          <SubRow label="MGGO" values={row.mggoDays} />
        </>
      ) : null}
    </>
  );
}

function SubRow({ label, values }: { label: string; values: number[] }) {
  return (
    <tr className="bg-muted/20 text-[11px]">
      <td className={cn(STICKY[0], "px-1 py-0.5")} />
      <td className={cn(STICKY[1], "px-1.5 py-0.5 text-muted-foreground")} colSpan={1}>
        {label}
      </td>
      <td className={cn(STICKY[2], "px-1.5 py-0.5")} />
      <td className={cn(STICKY[3], "px-1.5 py-0.5")} />
      <td className={cn(STICKY[4], "px-1.5 py-0.5")} />
      <td className="px-1.5 py-0.5" />
      {values.map((v, i) => (
        <td key={`${label}-${i}`} className="px-0.5 py-0.5 text-center">
          {v || ""}
        </td>
      ))}
    </tr>
  );
}

export function ComparisonSimpleTable({
  riders,
  mode,
}: {
  riders: ComparisonRider[];
  mode: "unused" | "mggo_only";
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr>
          <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5")}>MG ID</th>
          <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5")}>Rider Name</th>
          <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5")}>Restaurant</th>
          {mode === "unused" ? (
            <>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5")}>AM Orders</th>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5")}>Days with orders</th>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5")}>Avg per day</th>
            </>
          ) : (
            <>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5")}>MGGO Orders</th>
              <th className={cn(TABLE_HEAD_CLASS, "px-2 py-1.5")}>Days with a difference</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {riders.map((row) => (
          <tr key={row.mgId} className="border-t border-border">
            <td className="px-2 py-1.5 font-medium">{row.mgId}</td>
            <td className="px-2 py-1.5">{row.name || "—"}</td>
            <td className="px-2 py-1.5">{row.restaurant}</td>
            {mode === "unused" ? (
              <>
                <td className="px-2 py-1.5">{row.am}</td>
                <td className="px-2 py-1.5">{row.workedDays}</td>
                <td className="px-2 py-1.5">
                  {row.workedDays ? (row.am / row.workedDays).toFixed(1) : "0"}
                </td>
              </>
            ) : (
              <>
                <td className="px-2 py-1.5">{row.mggo}</td>
                <td className="px-2 py-1.5">{row.offDays}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function formatShare(n: number): string {
  return formatPct(n);
}
