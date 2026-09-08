"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { AppEmptyState, AppListCard } from "@/components/app";
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
import { useAuth } from "@/contexts/auth-context";
import { useDpdScopeOptions } from "@/features/dpd/use-dpd";
import { addDays, kuwaitToday } from "./performance-formulas";
import { formatUncappedPct } from "./performance-dpd-formulas";
import { buildDpdEfficiencyWorkbook } from "./performance-dpd-xlsx";
import { useDpdEfficiencySnapshot } from "./use-performance";
import type { DpdEfficiencyRider } from "./performance-types";

function RiderTable({
  rows,
  t,
}: {
  rows: DpdEfficiencyRider[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
            <TableHead className={TABLE_HEAD_CLASS}>{t("colRestaurant")}</TableHead>
            <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colEfficiency")}</TableHead>
            <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colActual")}</TableHead>
            <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colTarget")}</TableHead>
            <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colDpdRider")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-sm text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.driver_id}>
                <TableCell>
                  <p className="truncate text-sm font-medium">{row.driver_name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {row.employee_id || row.driver_code}
                  </p>
                </TableCell>
                <TableCell className="text-sm">{row.restaurant_name || "—"}</TableCell>
                <TableCell className="text-end tabular-nums text-sm font-semibold">
                  {formatUncappedPct(row.efficiency)}
                </TableCell>
                <TableCell className="text-end tabular-nums text-sm">{row.actual}</TableCell>
                <TableCell className="text-end tabular-nums text-sm">
                  {row.target ?? t("noTarget")}
                </TableCell>
                <TableCell className="text-end tabular-nums text-sm">
                  {row.dpd_rider == null ? "—" : (Math.round(row.dpd_rider * 10) / 10)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function PerformanceDpdPanel() {
  const t = useTranslations("pages.performance.dpd");
  const tf = useTranslations("pages.performance");
  const { can } = useAuth();
  const canExport = can("performance.export");
  const today = kuwaitToday();
  const [fromDate, setFromDate] = useState(addDays(today, -6));
  const [toDate, setToDate] = useState(today);
  const [restaurantId, setRestaurantId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [openZone, setOpenZone] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data: scopeOptions } = useDpdScopeOptions();
  const { data, isLoading, isError } = useDpdEfficiencySnapshot({
    from: fromDate,
    to: toDate,
    restaurantId: restaurantId || undefined,
    zoneId: zoneId || undefined,
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
  const zoneItems = useMemo(
    () =>
      (scopeOptions?.zones ?? []).map((z) => ({
        value: z.id,
        label: z.name,
        keywords: [z.name, z.code],
      })),
    [scopeOptions],
  );

  const zoneChildren = useMemo(() => {
    if (!openZone || !data) return [];
    return data.zone_restaurants.filter((r) => (r.zone_id ?? "") === openZone);
  }, [data, openZone]);

  const handleExport = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const buf = await buildDpdEfficiencyWorkbook(data);
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dpd-efficiency-${data.from}-${data.to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="h-9 w-[140px]"
        />
        <Input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="h-9 w-[140px]"
        />
        <div className="min-w-[180px] flex-1">
          <SearchSelect
            value={restaurantId || null}
            onChange={(v) => setRestaurantId(v ?? "")}
            items={restaurantItems}
            placeholder={tf("filterRestaurantAll")}
            recentsKey="dpd-efficiency-restaurant"
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <SearchSelect
            value={zoneId || null}
            onChange={(v) => setZoneId(v ?? "")}
            items={zoneItems}
            placeholder={tf("filterZoneAll")}
            recentsKey="dpd-efficiency-zone"
          />
        </div>
        {canExport ? (
          <Button
            type="button"
            variant="outline"
            className="h-9 cursor-pointer"
            disabled={!data || exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("export")}
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <AppEmptyState title={t("errorTitle")} description={t("errorHint")} />
      ) : (data?.top10.length ?? 0) === 0 && (data?.bottom10.length ?? 0) === 0 ? (
        <AppEmptyState title={t("noTargetsTitle")} description={t("noTargetsHint")} />
      ) : (
        <>
          <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
            <AppListCard className="h-full">
              <p className="px-4 pt-4 text-sm font-semibold">{t("top10")}</p>
              <RiderTable rows={data?.top10 ?? []} t={t} />
            </AppListCard>
            <AppListCard className="h-full">
              <p className="px-4 pt-4 text-sm font-semibold">{t("bottom10")}</p>
              <RiderTable rows={data?.bottom10 ?? []} t={t} />
            </AppListCard>
          </div>

          <AppListCard>
            <p className="px-4 pt-4 text-sm font-semibold">{t("zonesTitle")}</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colZone")}</TableHead>
                    <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colActual")}</TableHead>
                    <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colTarget")}</TableHead>
                    <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>
                      {t("colEfficiency")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.zones ?? []).map((zone) => (
                    <TableRow
                      key={zone.id ?? "none"}
                      className="cursor-pointer"
                      onClick={() =>
                        setOpenZone((cur) => (cur === (zone.id ?? "") ? null : (zone.id ?? "")))
                      }
                    >
                      <TableCell className="text-sm font-medium">
                        {zone.name ?? t("unassigned")}
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-sm">{zone.actual}</TableCell>
                      <TableCell className="text-end tabular-nums text-sm">
                        {zone.target ?? "—"}
                      </TableCell>
                      <TableCell className="text-end tabular-nums text-sm font-semibold">
                        {formatUncappedPct(zone.efficiency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {openZone && zoneChildren.length > 0 ? (
              <div className="border-t border-border px-4 py-3">
                <p className="mb-2 text-[10px] text-muted-foreground">
                  {t("zoneRestaurants", {
                    zone:
                      data?.zones.find((z) => (z.id ?? "") === openZone)?.name ?? t("unassigned"),
                  })}
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("colRestaurant")}</TableHead>
                      <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>{t("colActual")}</TableHead>
                      <TableHead className={`${TABLE_HEAD_CLASS} text-end`}>
                        {t("colEfficiency")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zoneChildren.map((row) => (
                      <TableRow key={`${row.zone_id}-${row.restaurant_id}`}>
                        <TableCell className="text-sm">{row.restaurant_name || "—"}</TableCell>
                        <TableCell className="text-end tabular-nums text-sm">{row.actual}</TableCell>
                        <TableCell className="text-end tabular-nums text-sm">
                          {formatUncappedPct(row.efficiency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </AppListCard>
        </>
      )}
    </div>
  );
}
