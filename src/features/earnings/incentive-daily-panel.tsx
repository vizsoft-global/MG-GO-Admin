"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2 } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDpdScopeOptions } from "@/features/dpd/use-dpd";
import { defaultEndDate, defaultStartDate } from "@/lib/date/kuwait-dates";
import { buildIncentiveDailyWorkbook } from "./incentive-daily-xlsx";
import { useIncentiveDailyDrivers, useIncentiveDailyReport } from "./use-earnings";

export function IncentiveDailyPanel() {
  const t = useTranslations("pages.earnings");
  const [fromDate, setFromDate] = useState(defaultStartDate);
  const [toDate, setToDate] = useState(defaultEndDate);
  const [driverId, setDriverId] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [exporting, setExporting] = useState(false);

  const { data: scopeOptions } = useDpdScopeOptions();
  const { data: drivers } = useIncentiveDailyDrivers();
  const query = useIncentiveDailyReport({
    from: fromDate,
    to: toDate,
    driverId: driverId || undefined,
    restaurantId: restaurantId || undefined,
  });

  const restaurantItems = useMemo(
    () =>
      (scopeOptions?.restaurants ?? []).map((r) => ({
        value: r.id,
        label: r.name,
        keywords: [r.name, r.partner_name],
      })),
    [scopeOptions],
  );

  const driverItems = useMemo(
    () =>
      (drivers ?? []).map((d) => ({
        value: d.id,
        label: d.full_name,
        hint: d.employee_id || d.driver_code,
        keywords: [d.full_name, d.employee_id, d.driver_code],
      })),
    [drivers],
  );

  const handleExport = async () => {
    if (!query.data) return;
    setExporting(true);
    try {
      const buf = await buildIncentiveDailyWorkbook(query.data);
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `incentive-daily-${query.data.from}-${query.data.to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t("incentiveDailyTitle")}</p>
      <p className="text-[10px] text-muted-foreground">{t("incentiveDailyHint")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="incentive-daily-from" className="text-[10px] text-muted-foreground">
            {t("startDate")}
          </label>
          <Input
            id="incentive-daily-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-9 w-[140px]"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="incentive-daily-to" className="text-[10px] text-muted-foreground">
            {t("endDate")}
          </label>
          <Input
            id="incentive-daily-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-9 w-[140px]"
          />
        </div>
        <div className="min-w-[180px] flex-1">
          <SearchSelect
            value={driverId || null}
            onChange={(v) => setDriverId(v ?? "")}
            items={driverItems}
            placeholder={t("filterDriverAll")}
            searchPlaceholder={t("searchDriver")}
            recentsKey="earnings-incentive-driver"
          />
        </div>
        <div className="min-w-[180px] flex-1">
          <SearchSelect
            value={restaurantId || null}
            onChange={(v) => setRestaurantId(v ?? "")}
            items={restaurantItems}
            placeholder={t("filterRestaurantAll")}
            searchPlaceholder={t("searchRestaurant")}
            recentsKey="earnings-incentive-restaurant"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9 cursor-pointer"
          disabled={!query.data || exporting}
          onClick={() => void handleExport()}
        >
          {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          {t("incentiveDailyExport")}
        </Button>
      </div>

      {query.isError ? (
        <p className="text-sm text-destructive">{t("loadFailed")}</p>
      ) : query.isLoading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployeeId")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colDate")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colRestaurant")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colZone")}</TableHead>
                <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colDeliveries")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colAppliedRule")}</TableHead>
                <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colDailyAmount")}</TableHead>
                <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colPeriodTotal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(query.data?.rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-sm text-muted-foreground">
                    {t("emptyTitle")}
                  </TableCell>
                </TableRow>
              ) : (
                (query.data?.rows ?? []).map((row) => (
                  <TableRow key={row.id || `${row.driver_id}-${row.earn_date}`}>
                    <TableCell>
                      <p className="truncate text-sm font-medium">{row.driver_name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{row.driver_code}</p>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{row.employee_id || "—"}</TableCell>
                    <TableCell className="tabular-nums text-sm">{row.earn_date}</TableCell>
                    <TableCell className="text-sm">{row.restaurant_name || "—"}</TableCell>
                    <TableCell className="text-sm">{row.zone_name || "—"}</TableCell>
                    <TableCell className="text-end tabular-nums text-sm">{row.deliveries}</TableCell>
                    <TableCell className="text-sm">{row.applied_rule || "—"}</TableCell>
                    <TableCell className="text-end tabular-nums text-sm">
                      {row.daily_amount_kwd.toFixed(3)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums text-sm font-medium">
                      {row.period_total_kwd.toFixed(3)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
