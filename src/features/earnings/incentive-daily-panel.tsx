"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
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
  const columns = useMemo((): TableToolbarColumn[] => [
    { id: "driver", label: t("colDriver"), locked: true },
    { id: "employee", label: t("colEmployeeId") },
    { id: "date", label: t("colDate") },
    { id: "restaurant", label: t("colRestaurant") },
    { id: "zone", label: t("colZone") },
    { id: "deliveries", label: t("colDeliveries") },
    { id: "rule", label: t("colAppliedRule") },
    { id: "daily", label: t("colDailyAmount") },
    { id: "period", label: t("colPeriodTotal") },
  ], [t]);
  const prefs = useTablePrefs("earnings-incentive-daily", columns);

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
      <p className="text-xs text-muted-foreground">{t("incentiveDailyHint")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="incentive-daily-from" className="text-xs text-muted-foreground">
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
          <label htmlFor="incentive-daily-to" className="text-xs text-muted-foreground">
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
      </div>

      {query.isError ? (
        <p className="text-sm text-destructive">{t("loadFailed")}</p>
      ) : query.isLoading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <TableToolbar
            prefs={prefs}
            entity={t("incentiveDailyExport")}
            columns={columns}
            rowKind="dynamic"
            filteredCount={(query.data?.rows ?? []).filter((row) => {
              const needle = prefs.appliedQuery.trim().toLowerCase();
              return !needle || `${row.driver_name} ${row.employee_id} ${row.restaurant_name} ${row.zone_name}`.toLowerCase().includes(needle);
            }).length}
            totalCount={(query.data?.rows ?? []).length}
            onExport={() => void handleExport()}
          />
          <Table>
            <TableHeader>
              <TableRow>
                {prefs.orderedColumns.filter((column) => prefs.isVisible(column.id)).map((column) => (
                  <TableHead key={column.id} className={TABLE_HEAD_CLASS}>{column.label}</TableHead>
                ))}
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
                (query.data?.rows ?? []).filter((row) => {
                  const needle = prefs.appliedQuery.trim().toLowerCase();
                  return !needle || `${row.driver_name} ${row.employee_id} ${row.restaurant_name} ${row.zone_name}`.toLowerCase().includes(needle);
                }).map((row) => (
                  <TableRow key={row.id || `${row.driver_id}-${row.earn_date}`}>
                    {prefs.orderedColumns.filter((column) => prefs.isVisible(column.id)).map((column) => {
                      if (column.id === "driver") return <TableCell key={column.id}><TableNameCell name={row.driver_name} /><p className="font-mono text-xs text-muted-foreground">{row.driver_code}</p></TableCell>;
                      if (column.id === "employee") return <TableCell key={column.id} className="font-mono text-sm">{row.employee_id ? row.employee_id : <EmptyCell />}</TableCell>;
                      if (column.id === "date") return <TableCell key={column.id} className="tabular-nums text-sm">{row.earn_date}</TableCell>;
                      if (column.id === "restaurant") return <TableCell key={column.id} className="text-sm">{row.restaurant_name ? row.restaurant_name : <EmptyCell />}</TableCell>;
                      if (column.id === "zone") return <TableCell key={column.id} className="text-sm">{row.zone_name ? row.zone_name : <EmptyCell />}</TableCell>;
                      if (column.id === "deliveries") return <TableCell key={column.id} className="text-end tabular-nums text-sm">{row.deliveries}</TableCell>;
                      if (column.id === "rule") return <TableCell key={column.id} className="text-sm">{row.applied_rule ? row.applied_rule : <EmptyCell />}</TableCell>;
                      if (column.id === "daily") return <TableCell key={column.id} className="text-end tabular-nums text-sm">{row.daily_amount_kwd.toFixed(3)}</TableCell>;
                      return <TableCell key={column.id} className="text-end tabular-nums text-sm font-medium">{row.period_total_kwd.toFixed(3)}</TableCell>;
                    })}
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
