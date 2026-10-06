"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Hand } from "lucide-react";
import { toast } from "sonner";
import { TABLE_HEAD_CLASS } from "@/components/app";
import { SearchField } from "@/components/app";
import { payrollRiderMatchesSearch, type PayrollPeriod } from "./payroll-formulas";
import { AdjustmentDialog, type AdjustmentDialogState } from "./adjustment-dialog";
import { PayrollDayGrid, PayrollLegend, type PayrollAdjustRequest } from "./payroll-grid";
import { exportCombinedPayrollCsv } from "./payroll-csv";
import { configByKey, exportLabelsFromConfig, hiddenSetFor } from "./payroll-column-config";
import { PayrollColumnsMenu } from "./payroll-heading";
import { useApplyPayrollAdjustments, usePayrollAdjustmentAudit, usePayrollColumnConfig } from "./use-payroll";
import type { PayrollAdjustmentCell, PayrollRiderRow } from "./payroll-types";

export function CombinedPayrollTab({
  month,
  riders,
  canExport,
  canManage,
}: {
  month: PayrollPeriod;
  riders: readonly PayrollRiderRow[];
  canExport: boolean;
  canManage: boolean;
}) {
  const t = useTranslations("pages.payroll");
  const [search, setSearch] = useState("");
  const [adjust, setAdjust] = useState<AdjustmentDialogState | null>(null);
  const apply = useApplyPayrollAdjustments();
  const audit = usePayrollAdjustmentAudit({ from: month.from, to: month.to });
  const headings = usePayrollColumnConfig();
  const headingConfig = useMemo(() => configByKey(headings.data), [headings.data]);

  const searched = useMemo(
    () => riders.filter((r) => payrollRiderMatchesSearch(r, search)),
    [riders, search],
  );

  const adjustedCells = useMemo(
    () => searched.reduce((sum, row) => sum + row.adjustedCells, 0),
    [searched],
  );

  const onRequestAdjust = useCallback((request: PayrollAdjustRequest) => {
    setAdjust(request);
  }, []);

  const onNotice = useCallback((message: string) => {
    if (message) toast.warning(message);
  }, []);

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

  const fallbackLabel = useCallback((key: string) => t(`riderCols.${key}`), [t]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-[12px] leading-5 shadow-sm">
          <b>{t("combinedBannerTitle")}</b> {t("combinedBannerBody")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PayrollColumnsMenu
            view="combined"
            config={headingConfig}
            fallbackLabel={fallbackLabel}
            canManage={canManage}
          />
          <span className="inline-flex h-9 items-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-3 text-[11px] font-semibold text-orange-800">
            <Hand className="size-3.5" />
            {t("adjust.adjustedCells", { count: adjustedCells })}
          </span>
        </div>
      </div>
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder={t("searchPlaceholder")}
        clearLabel={t("clearSearch")}
      />
      <PayrollDayGrid
        dates={month.dates}
        rows={searched}
        empty={t("emptyRiders")}
        exportLabel={t("downloadTable")}
        headingConfig={headingConfig}
        headingManage={canManage}
        onExport={(visible) => {
          if (canExport) {
            exportCombinedPayrollCsv(month.key, month.dates, visible, {
              labels: exportLabelsFromConfig(headingConfig, fallbackLabel),
              hidden: hiddenSetFor("combined", headingConfig),
            });
          }
        }}
        editor={canManage ? { canManage, onRequestAdjust, onNotice } : undefined}
        footer={t("tableFootRange", {
          shown: searched.length,
          total: riders.length,
          range: month.label,
        })}
      />
      <PayrollLegend riders={searched} />
      <AdjustmentDialog
        state={adjust}
        pending={apply.isPending}
        onCancel={() => {
          if (!apply.isPending) setAdjust(null);
        }}
        onConfirm={confirm}
      />
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-2">
          <h3 className="text-[13px] font-semibold">{t("manualChanges.title")}</h3>
          <p className="text-[10px] text-muted-foreground">{t("manualChanges.hint")}</p>
        </div>
        <div className="max-h-[min(240px,28dvh)] overflow-auto">
          <table className="w-max min-w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-card">
              <tr>
                <th className={TABLE_HEAD_CLASS}>{t("manualChanges.when")}</th>
                <th className={TABLE_HEAD_CLASS}>{t("manualChanges.who")}</th>
                <th className={TABLE_HEAD_CLASS}>{t("manualChanges.rider")}</th>
                <th className={TABLE_HEAD_CLASS}>{t("manualChanges.day")}</th>
                <th className={TABLE_HEAD_CLASS}>{t("manualChanges.original")}</th>
                <th className={TABLE_HEAD_CLASS}>{t("manualChanges.adjusted")}</th>
                <th className={TABLE_HEAD_CLASS}>{t("manualChanges.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {(audit.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("manualChanges.empty")}
                  </td>
                </tr>
              ) : (
                (audit.data ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="whitespace-nowrap px-2 py-1.5">{row.adjustedAt}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.actorName}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {row.driverName} · {row.mgId}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.workDate}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.originalStatus ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      {row.adjustedStatus}
                      {row.adjustedHours != null ? ` · ${row.adjustedHours}h` : ""}
                    </td>
                    <td className="px-2 py-1.5">{row.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function errorKey(code: string): string {
  const known = ["reason_required", "no_cells", "too_many_cells", "not_authorized"];
  return known.includes(code) ? code : "unknown";
}
