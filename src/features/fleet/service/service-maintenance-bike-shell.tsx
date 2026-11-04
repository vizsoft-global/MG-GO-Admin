"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Gauge,
  Upload,
  Wrench,
} from "lucide-react";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { AppListCard } from "@/components/app/app-list-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { useRouter } from "@/i18n/navigation";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { useLocale, useTranslations } from "next-intl";
import { buildProgramRows, programCounts } from "./service-maintenance-model";
import type { MaintenanceProgramRow, MaintenanceStatus } from "./types";
import { downloadServiceMaintenanceXlsx } from "./service-maintenance-xlsx";
import { ServiceBikeImportDialog } from "./service-bike-import-dialog";
import { ServiceBikeRecordDialog } from "./service-bike-record-dialog";
import { useServiceMaintenance } from "./use-service";

const STATUS_TONE: Record<MaintenanceStatus, string> = {
  normal: "border-emerald-200 bg-emerald-50 text-emerald-700",
  due_soon: "border-amber-200 bg-amber-50 text-amber-800",
  due: "border-orange-200 bg-orange-50 text-orange-800",
  overdue: "border-rose-200 bg-rose-50 text-rose-700",
  needs_baseline: "border-sky-200 bg-sky-50 text-sky-800",
  no_rule: "border-violet-200 bg-violet-50 text-violet-800",
  not_tracked: "border-border bg-muted text-muted-foreground",
  unknown: "border-border bg-muted text-muted-foreground",
};

/**
 * `/fleet/service/bikes` — the bike maintenance page.
 *
 * It exists separately from the cars tab because a bike is scheduled differently:
 * oil every 1,500 km or 10 days, brakes and chain every 45 days, and the bike's
 * odometer is not dependable enough to carry a tyre interval. It also carries the
 * one figure we can produce without Bajaj Care — **today's distance**, summed
 * from our own shift-out ledger.
 */
export function ServiceBikeShell({
  canManage,
  canExport,
}: {
  canManage: boolean;
  canExport: boolean;
}) {
  const t = useTranslations("pages.fleetService");
  const tStatus = useTranslations("pages.fleetService.maintenance.statuses");
  const locale = useLocale();
  const router = useRouter();
  const data = useServiceMaintenance("bike");
  const [importOpen, setImportOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);

  const today = kuwaitTodayYmd();
  const rows = useMemo(
    () =>
      data.data
        ? buildProgramRows({
            vehicles: data.data.vehicles,
            doneRecords: data.data.doneRecords,
            schedules: data.data.schedules,
            settings: data.data.settings,
            exclusions: data.data.exclusions,
            distances: data.data.distances,
            vehicleTypeKeys: ["bike"],
            today,
            locale,
          })
        : [],
    [data.data, today, locale],
  );

  const counts = programCounts(rows);


  function intervalText(row: MaintenanceProgramRow): string {
    const parts: string[] = [];
    if (row.kmInterval > 0) parts.push(`${row.kmInterval} km`);
    if (row.dayInterval > 0) parts.push(`${row.dayInterval} ${t("bikes.days")}`);
    return parts.length > 0 ? parts.join(" / ") : "—";
  }

  function todayKm(row: MaintenanceProgramRow): string {
    if (row.todayMeters == null) return t("bikes.noDistance");
    return `${(row.todayMeters / 1000).toFixed(1)} km`;
  }

  const columnLabels = {
    plate: t("maintenance.cols.plate"),
    program: t("maintenance.cols.program"),
    interval: t("bikes.colInterval"),
    driver: t("maintenance.cols.driver"),
    currentKm: t("maintenance.cols.currentKm"),
    todayKm: t("bikes.colToday"),
    lastKm: t("maintenance.cols.lastKm"),
    lastDate: t("maintenance.cols.lastDate"),
    nextKm: t("maintenance.cols.nextKm"),
    nextDate: t("maintenance.cols.nextDate"),
    remainingDays: t("maintenance.cols.remainingDays"),
    status: t("maintenance.cols.status"),
  } satisfies Record<string, string>;

  return (
    <AppPage className="space-y-4">
      <AppPageHeader
        title={t("bikes.title")}
        description={t("bikes.subtitle")}
        breadcrumbs={[
          { label: t("breadcrumb.title"), href: "/fleet/service" },
          { label: t("bikes.title") },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => router.push("/fleet/service?tab=maintenance")}
            >
              <ArrowLeft className="me-1 h-4 w-4" />
              {t("bikes.backToCars")}
            </Button>
            {canExport ? (
              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={() =>
                  void downloadServiceMaintenanceXlsx(rows, {
                    provisional: data.data?.settings.provisional ?? true,
                    labelStatus: (status) => tStatus(status),
                    labelProvisional: t("maintenance.provisionalTag"),
                    columnLabels: {
                      plate: columnLabels.plate,
                      program: columnLabels.program,
                      model: t("maintenance.cols.model"),
                      condition: t("maintenance.cols.condition"),
                      driver: columnLabels.driver,
                      currentKm: columnLabels.currentKm,
                      lastKm: columnLabels.lastKm,
                      lastDate: columnLabels.lastDate,
                      nextKm: columnLabels.nextKm,
                      remainingKm: t("maintenance.cols.remainingKm"),
                      daysSince: t("maintenance.cols.daysSince"),
                      nextDate: columnLabels.nextDate,
                      remainingDays: columnLabels.remainingDays,
                      kmInterval: t("maintenance.kmInterval"),
                      dayInterval: t("maintenance.dayInterval"),
                      status: columnLabels.status,
                    },
                  })
                }
              >
                {t("actions.export")}
              </Button>
            ) : null}
            {canManage ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  onClick={() => setImportOpen(true)}
                >
                  <Upload className="me-1 h-4 w-4" />
                  {t("bikes.importTitle")}
                </Button>
                <Button type="button" className="h-9" onClick={() => setRecordOpen(true)}>
                  {t("bikes.addRecord")}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <KpiGrid
        compact
        items={[
          { label: tStatus("normal"), value: counts.normal, icon: CheckCircle2 },
          { label: tStatus("due_soon"), value: counts.due_soon, icon: CalendarClock },
          { label: tStatus("due"), value: counts.due, icon: Gauge },
          { label: tStatus("overdue"), value: counts.overdue, icon: AlertTriangle },
          { label: tStatus("needs_baseline"), value: counts.needs_baseline, icon: Wrench },
        ]}
      />

      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {t("bikes.phaseTwoNote")}
      </p>

      <AppListCard>
        <AppDataTable
          columns={Object.entries(columnLabels).map(([id, label]) => ({ id, label }))}
          empty={
            rows.length === 0 ? (
              <AppDataTableEmpty>
                <AppEmptyState
                  title={t("bikes.emptyTitle")}
                  description={t("bikes.emptyHint")}
                />
              </AppDataTableEmpty>
            ) : null
          }
        >
          {rows.map((row) => (
            <AppDataTableRow key={`${row.vehicleId}_${row.programKey}`}>
              <TableCell className="whitespace-nowrap font-medium">{row.plate}</TableCell>
              <TableCell className="whitespace-nowrap">{row.programLabel}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {intervalText(row)}
              </TableCell>
              <TableCell className="whitespace-nowrap">{row.driverName ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {row.currentKm == null ? t("maintenance.unknown") : row.currentKm}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{todayKm(row)}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {row.lastServiceKm ?? "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {row.lastServiceDate ?? "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {row.kmInterval <= 0 ? "—" : row.nextDueKm ?? t("maintenance.unknown")}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {row.dayInterval <= 0 ? "—" : row.nextDueDate ?? t("maintenance.unknown")}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {row.dayInterval <= 0 ? "—" : row.remainingDays ?? "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <Badge variant="outline" className={STATUS_TONE[row.status]}>
                  {tStatus(row.status)}
                </Badge>
              </TableCell>
            </AppDataTableRow>
          ))}
        </AppDataTable>
      </AppListCard>

      <ServiceBikeImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ServiceBikeRecordDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        vehicles={data.data?.vehicles ?? []}
      />
    </AppPage>
  );
}
