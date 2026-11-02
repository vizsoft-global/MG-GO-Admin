"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, CalendarClock, CheckCircle2, Gauge, Wrench } from "lucide-react";
import { AppDataTable, AppDataTableEmpty, AppDataTableRow, TableCell } from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { AppListCard } from "@/components/app/app-list-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { buildMaintenanceRows, maintenanceCounts } from "./service-maintenance-model";
import type { MaintenanceStatus } from "./types";
import { downloadServiceMaintenanceXlsx } from "./service-maintenance-xlsx";
import { ServiceScheduleDialog } from "./service-schedule-dialog";
import { useServiceMaintenance } from "./use-service";

const STATUS_TONE: Record<MaintenanceStatus, string> = {
  normal: "border-emerald-200 bg-emerald-50 text-emerald-700",
  due_soon: "border-amber-200 bg-amber-50 text-amber-800",
  due: "border-orange-200 bg-orange-50 text-orange-800",
  overdue: "border-rose-200 bg-rose-50 text-rose-700",
  unknown: "border-border bg-muted text-muted-foreground",
};

const COLUMNS = [
  "plate",
  "model",
  "condition",
  "driver",
  "currentKm",
  "lastKm",
  "lastDate",
  "nextKm",
  "remainingKm",
  "daysSince",
  "nextDate",
  "remainingDays",
  "status",
] as const;

export function ServiceMaintenanceTab({
  canManage,
  canExport,
}: {
  canManage: boolean;
  canExport: boolean;
}) {
  const t = useTranslations("pages.fleetService");
  const tStatus = useTranslations("pages.fleetService.maintenance.statuses");
  const router = useRouter();
  const data = useServiceMaintenance();
  const [tab, setTab] = useState<"all" | MaintenanceStatus>("all");
  const [zone, setZone] = useState("all");
  const [vehicleType, setVehicleType] = useState("all");
  const [model, setModel] = useState("all");
  const [driver, setDriver] = useState("all");
  const [schedulesOpen, setSchedulesOpen] = useState(false);

  const today = kuwaitTodayYmd();
  const rows = useMemo(
    () =>
      data.data
        ? buildMaintenanceRows({
            vehicles: data.data.vehicles,
            doneRecords: data.data.doneRecords,
            schedules: data.data.schedules,
            settings: data.data.settings,
            today,
          })
        : [],
    [data.data, today],
  );

  const counts = maintenanceCounts(rows);
  const provisional = data.data?.settings.provisional ?? true;

  const options = useMemo(() => {
    const zones = new Set<string>();
    const types = new Set<string>();
    const models = new Set<string>();
    const drivers = new Set<string>();
    for (const row of rows) {
      if (row.zoneName) zones.add(row.zoneName);
      if (row.vehicleTypeKey) types.add(row.vehicleTypeKey);
      if (row.model) models.add(row.model);
      if (row.driverName) drivers.add(row.driverName);
    }
    const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
    return {
      zones: sorted(zones),
      types: sorted(types),
      models: sorted(models),
      drivers: sorted(drivers),
    };
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (tab !== "all" && row.status !== tab) return false;
        if (zone !== "all" && (row.zoneName ?? "") !== zone) return false;
        if (vehicleType !== "all" && (row.vehicleTypeKey ?? "") !== vehicleType) return false;
        if (model !== "all" && (row.model ?? "") !== model) return false;
        if (driver !== "all" && (row.driverName ?? "") !== driver) return false;
        return true;
      }),
    [rows, tab, zone, vehicleType, model, driver],
  );

  function value(id: (typeof COLUMNS)[number], row: (typeof rows)[number]) {
    switch (id) {
      case "plate":
        return row.plate;
      case "model":
        return row.model ?? "—";
      case "condition":
        return row.condition ?? "—";
      case "driver":
        return row.driverName ?? "—";
      case "currentKm":
        return row.currentKm == null ? t("maintenance.unknown") : String(row.currentKm);
      case "lastKm":
        return row.lastServiceKm == null ? t("maintenance.unknown") : String(row.lastServiceKm);
      case "lastDate":
        return row.lastServiceDate ?? "—";
      case "nextKm":
        return row.nextDueKm == null ? t("maintenance.unknown") : String(row.nextDueKm);
      case "remainingKm":
        return row.remainingKm == null ? t("maintenance.unknown") : String(row.remainingKm);
      case "daysSince":
        return row.daysSinceService == null ? "—" : String(row.daysSinceService);
      case "nextDate":
        return row.nextDueDate ?? "—";
      case "remainingDays":
        return row.remainingDays == null ? t("maintenance.unknown") : String(row.remainingDays);
      case "status":
        return null;
      default:
        return null;
    }
  }

  const columnLabels: Record<(typeof COLUMNS)[number], string> = {
    plate: t("maintenance.cols.plate"),
    model: t("maintenance.cols.model"),
    condition: t("maintenance.cols.condition"),
    driver: t("maintenance.cols.driver"),
    currentKm: t("maintenance.cols.currentKm"),
    lastKm: t("maintenance.cols.lastKm"),
    lastDate: t("maintenance.cols.lastDate"),
    nextKm: t("maintenance.cols.nextKm"),
    remainingKm: t("maintenance.cols.remainingKm"),
    daysSince: t("maintenance.cols.daysSince"),
    nextDate: t("maintenance.cols.nextDate"),
    remainingDays: t("maintenance.cols.remainingDays"),
    status: t("maintenance.cols.status"),
  };


  const statusItems = (["all", "normal", "due_soon", "due", "overdue", "unknown"] as const).map(
    (id) => ({
      id,
      label: `${id === "all" ? t("stages.all") : tStatus(id)} (${id === "all" ? rows.length : counts[id]})`,
    }),
  );

  return (
    <div className="space-y-3">
      {provisional ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t("maintenance.provisionalBanner")}</p>
        </div>
      ) : null}

      <KpiGrid
        compact
        items={[
          {
            label: tStatus("normal"),
            value: counts.normal,
            icon: CheckCircle2,
            caption: provisional ? t("maintenance.provisionalTag") : undefined,
          },
          { label: tStatus("due_soon"), value: counts.due_soon, icon: CalendarClock },
          { label: tStatus("due"), value: counts.due, icon: Gauge },
          { label: tStatus("overdue"), value: counts.overdue, icon: AlertTriangle },
          { label: tStatus("unknown"), value: counts.unknown, icon: Wrench },
        ]}
      />

      <AppListCard>
        <div className="space-y-3 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-end gap-2">
            {(
              [
                [zone, setZone, options.zones, t("maintenance.filters.zone"), "zone"],
                [vehicleType, setVehicleType, options.types, t("maintenance.filters.type"), "type"],
                [model, setModel, options.models, t("maintenance.filters.model"), "model"],
                [driver, setDriver, options.drivers, t("maintenance.filters.driver"), "driver"],
              ] as const
            ).map(([value, setValue, list, label, key]) => (
              <div key={key} className="w-[11rem] space-y-1 text-xs">
                <span className="block text-muted-foreground">{label}</span>
                <Select
                  items={[
                    { value: "all", label: t("filters.any") },
                    ...list.map((item) => ({ value: item, label: item })),
                  ]}
                  value={value}
                  onValueChange={(next) => setValue(next ?? "all")}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("filters.any")}</SelectItem>
                    {list.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <div className="ms-auto flex items-center gap-2">
              {canExport ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  onClick={() =>
                    void downloadServiceMaintenanceXlsx(filtered, {
                      provisional,
                      labelStatus: (status) => tStatus(status),
                      labelProvisional: t("maintenance.provisionalTag"),
                      columnLabels,
                    })
                  }
                >
                  {t("actions.export")}
                </Button>
              ) : null}
              {canManage ? (
                <Button type="button" className="h-9" onClick={() => setSchedulesOpen(true)}>
                  {t("actions.schedules")}
                </Button>
              ) : null}
            </div>
          </div>
          <TabBar items={statusItems} activeId={tab} onSelect={(id) => setTab(id as typeof tab)} />
        </div>

        <AppDataTable
          columns={COLUMNS.map((id) => ({ id, label: columnLabels[id] }))}
          empty={
            filtered.length === 0 ? (
              <AppDataTableEmpty>
                <AppEmptyState
                  title={t("maintenance.emptyTitle")}
                  description={t("maintenance.emptyHint")}
                />
              </AppDataTableEmpty>
            ) : null
          }
        >
          {filtered.map((row) => (
            <AppDataTableRow
              key={row.vehicleId}
              onClick={() => router.push(`/fleet/service?tab=records&vehicle=${row.vehicleId}`)}
            >
              {COLUMNS.map((id) => (
                <TableCell key={id} className="whitespace-nowrap">
                  {id === "status" ? (
                    <Badge variant="outline" className={STATUS_TONE[row.status]}>
                      {tStatus(row.status)}
                    </Badge>
                  ) : (
                    <span className={id === "plate" ? "font-medium" : "tabular-nums"}>
                      {value(id, row)}
                    </span>
                  )}
                </TableCell>
              ))}
            </AppDataTableRow>
          ))}
        </AppDataTable>
      </AppListCard>

      <ServiceScheduleDialog
        open={schedulesOpen}
        onOpenChange={setSchedulesOpen}
        data={data.data ?? null}
        provisional={provisional}
      />
    </div>
  );
}
