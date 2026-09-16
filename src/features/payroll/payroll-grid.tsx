"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Download } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { cn } from "@/lib/utils";
import { dayLabel, dayStatusLabel, type DayStatus } from "./payroll-formulas";
import { formatEfficiencyCell } from "./payroll-csv";
import type { PayrollRiderRow } from "./payroll-types";

function dayClass(status: DayStatus): string {
  switch (status) {
    case "work":
      return "text-muted-foreground";
    case "off":
      return "bg-emerald-100 text-emerald-800";
    case "sick":
      return "bg-amber-100 text-amber-800";
    case "accident":
      return "bg-lime-100 text-lime-800";
    case "absent":
      return "bg-red-100 text-red-700";
    case "blank":
      return "text-muted-foreground/40";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function PayrollDayGrid({
  monthKey,
  days,
  rows,
  footer,
  exportLabel,
  onExport,
  empty,
}: {
  monthKey: string;
  days: number;
  rows: readonly PayrollRiderRow[];
  footer: string;
  exportLabel: string;
  onExport: () => void;
  empty: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 16,
  });

  const dayHeaders = Array.from({ length: days }, (_, i) => dayLabel(monthKey, i + 1));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div ref={parentRef} className="max-h-[min(520px,52dvh)] overflow-auto">
        <table className="w-max min-w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {["AM ID", "MG ID", "Name", "Restaurant", "Zone", "Partner", "Nationality", "Status"].map(
                (h) => (
                  <th key={h} className={cn(TABLE_HEAD_CLASS, "whitespace-nowrap px-2 py-2")}>
                    {h}
                  </th>
                ),
              )}
              {dayHeaders.map((h) => (
                <th key={h} className={cn(TABLE_HEAD_CLASS, "min-w-[52px] px-1 py-2 text-center")}>
                  {h}
                </th>
              ))}
              {["Total Days", "Total Hours", "OFF", "Sick", "Accident", "Absence", "Fixed Days", "Efficiency%"].map(
                (h) => (
                  <th key={h} className={cn(TABLE_HEAD_CLASS, "whitespace-nowrap px-2 py-2")}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={16 + days}
                  className="px-3 py-8 text-center text-xs text-muted-foreground"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              <>
                {virtualizer.getVirtualItems().length > 0 ? (
                  <tr aria-hidden style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0 }}>
                    <td colSpan={16 + days} className="p-0" />
                  </tr>
                ) : null}
                {virtualizer.getVirtualItems().map((item) => {
                  const row = rows[item.index];
                  const eff = formatEfficiencyCell(row.efficiency);
                  return (
                    <tr key={row.driverId} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="whitespace-nowrap px-2 py-1.5">{row.amId}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.mgId}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-medium">{row.name}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.restaurant}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.zone}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.partner}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.nationality}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            row.status === "Active"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-700",
                          )}
                        >
                          {row.status}
                        </span>
                      </td>
                      {row.days.map((st, i) => (
                        <td
                          key={`${row.driverId}-${i}`}
                          className={cn(
                            "min-w-[52px] px-1 py-1.5 text-center text-[11px] font-semibold",
                            dayClass(st),
                          )}
                        >
                          {dayStatusLabel(st)}
                        </td>
                      ))}
                      <td className="px-2 py-1.5">{row.workDays}</td>
                      <td className="px-2 py-1.5">{row.totalHours}</td>
                      <td className="px-2 py-1.5">{row.offDays}</td>
                      <td className="px-2 py-1.5">{row.sickDays}</td>
                      <td className="px-2 py-1.5">{row.accidentDays}</td>
                      <td className="px-2 py-1.5">{row.absentDays}</td>
                      <td className="px-2 py-1.5">{row.fixedDays}</td>
                      <td
                        className={cn(
                          "px-2 py-1.5 font-semibold",
                          eff.tone === "good" && "text-emerald-700",
                          eff.tone === "bad" && "text-red-600",
                        )}
                      >
                        {eff.text}
                      </td>
                    </tr>
                  );
                })}
                {virtualizer.getVirtualItems().length > 0 ? (
                  <tr
                    aria-hidden
                    style={{
                      height: Math.max(
                        0,
                        virtualizer.getTotalSize() -
                          (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
                      ),
                    }}
                  >
                    <td colSpan={16 + days} className="p-0" />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span>{footer}</span>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-primary hover:bg-primary/10"
        >
          <Download className="size-3" />
          {exportLabel}
        </button>
      </div>
    </div>
  );
}

export function PayrollLegend() {
  const items: Array<{ label: string; className: string; swatch: string }> = [
    { label: "12", className: "text-muted-foreground", swatch: "#8d8d97" },
    { label: "OFF", className: "", swatch: "#33c777" },
    { label: "Sick", className: "", swatch: "#f0a83c" },
    { label: "Accident", className: "", swatch: "#9acd32" },
    { label: "Absent", className: "", swatch: "#ef5b5b" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] shadow-sm"
        >
          <span className="size-3.5 rounded-sm" style={{ background: item.swatch }} />
          <span className="font-semibold">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
