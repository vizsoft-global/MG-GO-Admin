"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { payrollRiderMatchesSearch, type PayrollMonthMeta } from "./payroll-formulas";
import { PayrollDayGrid } from "./payroll-grid";
import { exportPayrollViewCsv } from "./payroll-csv";
import type { PayrollRiderRow } from "./payroll-types";

export function CombinedPayrollTab({
  month,
  riders,
  canExport,
}: {
  month: PayrollMonthMeta;
  riders: readonly PayrollRiderRow[];
  canExport: boolean;
}) {
  const t = useTranslations("pages.payroll");
  const [search, setSearch] = useState("");
  const searched = useMemo(
    () => riders.filter((r) => payrollRiderMatchesSearch(r, search)),
    [riders, search],
  );

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-[12px] leading-5 shadow-sm">
        <b>{t("combinedBannerTitle")}</b> {t("combinedBannerBody")}
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
          if (canExport) exportPayrollViewCsv(month.key, month.days, searched);
        }}
        footer={t("tableFoot", {
          shown: searched.length,
          total: riders.length,
          month: month.label,
          days: month.days,
          fixed: month.fixedDays,
        })}
      />
    </div>
  );
}
