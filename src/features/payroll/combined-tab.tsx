"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Hand } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { payrollRiderMatchesSearch, type PayrollMonthMeta } from "./payroll-formulas";
import { AdjustmentDialog, type AdjustmentDialogState } from "./adjustment-dialog";
import { PayrollDayGrid } from "./payroll-grid";
import { exportCombinedPayrollCsv } from "./payroll-csv";
import { useApplyPayrollAdjustments } from "./use-payroll";
import type { PayrollAdjustmentCell, PayrollRiderRow } from "./payroll-types";

/**
 * The SOP's day grid: one row per rider, one column per day, and the only place
 * a hand adjustment is entered. Selection, the fill handle and the clipboard all
 * end in the same dialog, so there is exactly one path that writes a reason.
 */
export function CombinedPayrollTab({
  month,
  riders,
  canExport,
  canManage,
}: {
  month: PayrollMonthMeta;
  riders: readonly PayrollRiderRow[];
  canExport: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("pages.payroll");
  const [search, setSearch] = useState("");
  const [adjust, setAdjust] = useState<AdjustmentDialogState | null>(null);
  const apply = useApplyPayrollAdjustments();

  const searched = useMemo(
    () => riders.filter((r) => payrollRiderMatchesSearch(r, search)),
    [riders, search],
  );

  const adjustedCells = useMemo(
    () => searched.reduce((sum, row) => sum + row.adjustedCells, 0),
    [searched],
  );

  const onRequestAdjust = useCallback((cells: PayrollAdjustmentCell[]) => {
    const ridersTouched = new Set(cells.map((c) => c.driverId));
    const dates = new Set(cells.map((c) => c.date));
    setAdjust({
      cells,
      riderCount: ridersTouched.size,
      dayCount: dates.size,
    });
  }, []);

  const onNotice = useCallback(
    (message: string) => {
      if (message) toast.warning(message);
    },
    [],
  );

  function confirm(input: { cells: PayrollAdjustmentCell[]; reason: string }) {
    apply.mutate(input, {
      onSuccess: (result) => {
        if ("error" in result) {
          toast.error(t(`adjust.errors.${errorKey(result.error)}`));
          return;
        }
        toast.success(t("adjust.applied", { count: result.applied }));
        setAdjust(null);
      },
      onError: () => toast.error(t("adjust.errors.unknown")),
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-[12px] leading-5 shadow-sm">
          <b>{t("combinedBannerTitle")}</b> {t("combinedBannerBody")}
        </div>
        <span className="inline-flex h-9 items-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-3 text-[11px] font-semibold text-orange-800">
          <Hand className="size-3.5" />
          {t("adjust.adjustedCells", { count: adjustedCells })}
        </span>
      </div>
      <Input
        className="h-9"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("searchPlaceholder")}
      />
      <PayrollDayGrid
        monthKey={month.key}
        days={month.days}
        rows={searched}
        empty={t("emptyRiders")}
        exportLabel={t("downloadTable")}
        onExport={() => {
          if (canExport) exportCombinedPayrollCsv(month.key, month.days, searched);
        }}
        editor={canManage ? { canManage, onRequestAdjust, onNotice } : undefined}
        footer={t("tableFoot", {
          shown: searched.length,
          total: riders.length,
          month: month.label,
          days: month.days,
          fixed: month.fixedDays,
        })}
      />
      <AdjustmentDialog
        state={adjust}
        pending={apply.isPending}
        onCancel={() => {
          if (!apply.isPending) setAdjust(null);
        }}
        onConfirm={confirm}
      />
    </div>
  );
}

/**
 * The server returns a machine code; the dialog prints the sentence. Anything
 * unrecognised still has a sentence rather than a raw string on screen.
 */
function errorKey(code: string): string {
  const known = ["reason_required", "no_cells", "too_many_cells", "not_authorized"];
  return known.includes(code) ? code : "unknown";
}
