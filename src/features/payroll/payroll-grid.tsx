"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLocale, useTranslations } from "next-intl";
import { Briefcase, CalendarOff, HeartPulse, Siren, UserX } from "lucide-react";
import { Download } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { ToggleChip } from "@/components/app/toggle-chip";
import { cn } from "@/lib/utils";
import {
  countRidersByStatus,
  dayLabel,
  PAYROLL_STATUS_CHIP,
  PAYROLL_STATUS_FILTERS,
  shareOfPayroll,
  type DayStatus,
  type PayrollStatusFilter,
} from "./payroll-formulas";
import { formatEfficiencyCell } from "./payroll-csv";
import type { PayrollRiderRow } from "./payroll-types";

const IDENTITY_COLS = [
  "amId",
  "mgId",
  "name",
  "restaurant",
  "zone",
  "partner",
  "nationality",
  "status",
] as const;

const TOTAL_COLS = [
  "totalDays",
  "totalHours",
  "off",
  "sick",
  "accident",
  "absence",
  "offStructure",
  "requiredHours",
  "actualHours",
  "efficiency",
] as const;

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

function spacerCells(count: number) {
  return Array.from({ length: count }, (_, i) => <td key={i} className="p-0" />);
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
  const t = useTranslations("pages.payroll");
  const locale = useLocale();
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 16,
  });

  const colCount = 18 + days;
  const dayHeaders = Array.from({ length: days }, (_, i) => dayLabel(monthKey, i + 1, locale));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div ref={parentRef} className="max-h-[min(520px,52dvh)] overflow-auto">
        <table className="w-max min-w-full border-collapse text-[12px]">
          <colgroup>
            {Array.from({ length: colCount }, (_, i) => (
              <col
                key={i}
                className={i >= 8 && i < 8 + days ? "min-w-[52px]" : undefined}
              />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {IDENTITY_COLS.map((id) => (
                <th key={id} className={cn(TABLE_HEAD_CLASS, "whitespace-nowrap px-2 py-2")}>
                  {t(`riderCols.${id}`)}
                </th>
              ))}
              {dayHeaders.map((h) => (
                <th key={h} className={cn(TABLE_HEAD_CLASS, "min-w-[52px] px-1 py-2 text-center")}>
                  {h}
                </th>
              ))}
              {TOTAL_COLS.map((id) => (
                <th key={id} className={cn(TABLE_HEAD_CLASS, "whitespace-nowrap px-2 py-2")}>
                  {t(`riderCols.${id}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-3 py-8 text-center text-xs text-muted-foreground"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              <>
                {virtualizer.getVirtualItems().length > 0 ? (
                  <tr aria-hidden style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0 }}>
                    {spacerCells(colCount)}
                  </tr>
                ) : null}
                {virtualizer.getVirtualItems().map((item) => {
                  const row = rows[item.index];
                  const eff = formatEfficiencyCell(row.efficiency);
                  const statusKey = row.status === "Active" ? "active" : "inactive";
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
                          {t(`riderStatus.${statusKey}`)}
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
                          {st === "blank" ? "" : t(`dayStatus.${st}`)}
                        </td>
                      ))}
                      <td className="px-2 py-1.5">{row.workDays}</td>
                      <td className="px-2 py-1.5">{row.totalHours}</td>
                      <td className="px-2 py-1.5">{row.offDays}</td>
                      <td className="px-2 py-1.5">{row.sickDays}</td>
                      <td className="px-2 py-1.5">{row.accidentDays}</td>
                      <td className="px-2 py-1.5">{row.absentDays}</td>
                      <td className="px-2 py-1.5">{row.offStructureDays}</td>
                      <td className="px-2 py-1.5">{row.requiredHours.toFixed(1)}</td>
                      <td className="px-2 py-1.5">{row.actualHours.toFixed(2)}</td>
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
                    {spacerCells(colCount)}
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

const STATUS_ICONS = {
  work: Briefcase,
  off: CalendarOff,
  sick: HeartPulse,
  accident: Siren,
  absent: UserX,
} as const;

export function PayrollLegend({
  riders,
  selected,
  onSelect,
}: {
  riders?: readonly PayrollRiderRow[];
  selected?: PayrollStatusFilter | null;
  onSelect?: (status: PayrollStatusFilter | null) => void;
}) {
  const t = useTranslations("pages.payroll");
  const counts = riders ? countRidersByStatus(riders) : null;
  const total = riders?.length ?? 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {PAYROLL_STATUS_FILTERS.map((id) => (
          <ToggleChip
            key={id}
            selected={selected === id}
            onClick={() => onSelect?.(selected === id ? null : id)}
            icon={STATUS_ICONS[id]}
            leading={
              <span
                className="size-3.5 rounded-sm"
                style={{ background: PAYROLL_STATUS_CHIP[id].hex }}
              />
            }
          >
            {t(`legend.${id}`)}
            {counts ? ` · ${counts[id]}` : ""}
          </ToggleChip>
        ))}
      </div>
      {selected && counts ? (
        <div className="rounded-xl border border-emerald-400/50 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
          {t("shareCard", {
            status: t(`legend.${selected}`),
            count: counts[selected],
            total,
            share: shareOfPayroll(counts[selected], total).toFixed(1),
          })}
        </div>
      ) : null}
    </div>
  );
}

export function PayrollSummaryTable({
  rows,
  empty,
}: {
  rows: readonly PayrollRiderRow[];
  empty: string;
}) {
  const t = useTranslations("pages.payroll");
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="max-h-[min(420px,46dvh)] overflow-auto">
        <table className="w-max min-w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {[...IDENTITY_COLS, ...TOTAL_COLS].map((id) => (
                <th key={id} className={cn(TABLE_HEAD_CLASS, "whitespace-nowrap px-2 py-2")}>
                  {t(`riderCols.${id}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={IDENTITY_COLS.length + TOTAL_COLS.length}
                  className="px-3 py-8 text-center text-xs text-muted-foreground"
                >
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const eff = formatEfficiencyCell(row.efficiency);
                const statusKey = row.status === "Active" ? "active" : "inactive";
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
                        {t(`riderStatus.${statusKey}`)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{row.workDays}</td>
                    <td className="px-2 py-1.5">{row.totalHours}</td>
                    <td className="px-2 py-1.5">{row.offDays}</td>
                    <td className="px-2 py-1.5">{row.sickDays}</td>
                    <td className="px-2 py-1.5">{row.accidentDays}</td>
                    <td className="px-2 py-1.5">{row.absentDays}</td>
                    <td className="px-2 py-1.5">{row.offStructureDays}</td>
                    <td className="px-2 py-1.5">{row.requiredHours.toFixed(1)}</td>
                    <td className="px-2 py-1.5">{row.actualHours.toFixed(2)}</td>
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
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
