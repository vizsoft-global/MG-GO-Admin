"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Gauge,
  Upload,
  Wrench,
} from "lucide-react";
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
import { Pencil } from "lucide-react";
import {
  buildProgramRows,
  needsOdometerRows,
  needsSetupRows,
  noRuleRows,
  programCounts,
} from "./service-maintenance-model";
import { curatedPrograms, curatedVehicleTypes } from "./service-programs";
import type { MaintenanceProgramRow, MaintenanceStatus } from "./types";
import { downloadServiceMaintenanceXlsx } from "./service-maintenance-xlsx";
import { ServiceScheduleDialog } from "./service-schedule-dialog";
import { ServiceBaselineImportDialog } from "./service-baseline-import-dialog";
import { ServiceNeedsSetupPanel } from "./service-needs-setup-panel";
import { ServiceNextDueDialog } from "./service-next-due-dialog";
import { ServiceOdometerSyncDialog } from "./service-odometer-sync-dialog";
import { useServiceMaintenance } from "./use-service";

/**
 * Semantic tone per status. `needs_baseline` is amber because it asks the
 * operator for something; `not_tracked` is neutral because it is a decision that
 * has already been taken, not a gap.
 */
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

const COLUMNS = [
  "plate",
  "program",
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
  "actions",
] as const;

type ColumnId = (typeof COLUMNS)[number];

const STATUS_TABS = [
  "all",
  "normal",
  "due_soon",
  "due",
  "overdue",
  "needs_setup",
  "not_tracked",
] as const;

type StatusTab = (typeof STATUS_TABS)[number];

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
  // The cars tab never draws a bike row: `car` scopes the read by vehicle type.
  const data = useServiceMaintenance("car");
  const [tab, setTab] = useState<StatusTab>("all");
  const [program, setProgram] = useState("all");
  const [zone, setZone] = useState("all");
  const [model, setModel] = useState("all");
  const [driver, setDriver] = useState("all");
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [nextDue, setNextDue] = useState<MaintenanceProgramRow | null>(null);

  const today = kuwaitTodayYmd();
  const programs = data.data?.programs?.length ? data.data.programs : curatedPrograms();
  const rows = useMemo(
    () =>
      data.data
        ? buildProgramRows({
            vehicles: data.data.vehicles,
            doneRecords: data.data.doneRecords,
            schedules: data.data.schedules,
            settings: data.data.settings,
            exclusions: data.data.exclusions,
            overrides: data.data.overrides,
            programs,
            distances: data.data.distances,
            vehicleTypeKeys: ["car"],
            today,
          })
        : [],
    [data.data, programs, today],
  );

  const counts = programCounts(rows);
  // The banner is honest about *what judged these rows*: only an unapproved
  // fleet default can make a row provisional, and nothing is judged by those any
  // more, so this is false unless a rule is explicitly flagged.
  const provisional = counts.provisional;
  const setupRows = needsSetupRows(rows);
  const odometerRows = needsOdometerRows(rows, today);

  const options = useMemo(() => {
    const zones = new Set<string>();
    const models = new Set<string>();
    const drivers = new Set<string>();
    for (const row of rows) {
      if (row.zoneName) zones.add(row.zoneName);
      if (row.model) models.add(row.model);
      if (row.driverName) drivers.add(row.driverName);
    }
    const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
    return { zones: sorted(zones), models: sorted(models), drivers: sorted(drivers) };
  }, [rows]);

  // A program filter is what makes five rows per plate usable: "show me every
  // brake that is due" is a question the one-row-per-vehicle table could not
  // answer at all. The list is data-driven, so a program the fleet team added to
  // the catalog appears here without a code change.
  const programOptions = useMemo(
    () =>
      programs.filter((entry) => {
        const gated = curatedVehicleTypes(entry.key);
        return gated ? gated.includes("car") : true;
      }),
    [programs],
  );

  function selectStatus(next: StatusTab) {
    setTab(tab === next ? "all" : next);
  }

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (tab === "needs_setup") {
          // The card counts both worklists; the table must show both, or the
          // rows under a card printed 7 would number 3.
          if (row.status !== "needs_baseline" && row.status !== "no_rule") return false;
        } else if (tab !== "all" && row.status !== tab) return false;
        if (program !== "all" && row.programKey !== program) return false;
        if (zone !== "all" && (row.zoneName ?? "") !== zone) return false;
        if (model !== "all" && (row.model ?? "") !== model) return false;
        if (driver !== "all" && (row.driverName ?? "") !== driver) return false;
        return true;
      }),
    [rows, tab, program, zone, model, driver],
  );

  function value(id: ColumnId, row: MaintenanceProgramRow): string {
    switch (id) {
      case "plate":
        return row.plate;
      case "program":
        return row.programLabel;
      case "model":
        return row.model ?? "—";
      case "condition":
        return row.condition ?? "—";
      case "driver":
        return row.driverName ?? "—";
      case "currentKm":
        return row.currentKm == null ? t("maintenance.unknown") : String(row.currentKm);
      case "lastKm":
        return row.lastServiceKm == null ? "—" : String(row.lastServiceKm);
      case "lastDate":
        return row.lastServiceDate ?? "—";
      case "nextKm":
        // A dimension the rule does not track prints a dash, never "Unknown".
        return row.kmInterval <= 0 && !row.nextKmOverridden
          ? "—"
          : row.nextDueKm == null
            ? t("maintenance.unknown")
            : String(row.nextDueKm);
      case "remainingKm":
        return row.kmInterval <= 0 ? "—" : row.remainingKm == null ? "—" : String(row.remainingKm);
      case "daysSince":
        return row.daysSinceService == null ? "—" : String(row.daysSinceService);
      case "nextDate":
        return row.dayInterval <= 0 && !row.nextDateOverridden
          ? "—"
          : row.nextDueDate ?? t("maintenance.unknown");
      case "remainingDays":
        return row.dayInterval <= 0 ? "—" : row.remainingDays == null ? "—" : String(row.remainingDays);
      default:
        return "";
    }
  }

  const columnLabels: Record<ColumnId, string> = {
    plate: t("maintenance.cols.plate"),
    program: t("maintenance.cols.program"),
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
    actions: "",
  };

  const statusCounts: Record<StatusTab, number> = {
    all: rows.length,
    normal: counts.normal,
    due_soon: counts.due_soon,
    due: counts.due,
    overdue: counts.overdue,
    needs_setup: counts.needs_baseline + counts.no_rule,
    not_tracked: counts.not_tracked,
  };

  const statusItems = STATUS_TABS.map((id) => ({
    id,
    label: `${id === "all" ? t("stages.all") : id === "needs_setup" ? tStatus("needs_baseline") : tStatus(id)} (${statusCounts[id]})`,
  }));


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
            selected: tab === "normal",
            onClick: () => selectStatus("normal"),
          },
          {
            label: tStatus("due_soon"),
            value: counts.due_soon,
            icon: CalendarClock,
            selected: tab === "due_soon",
            onClick: () => selectStatus("due_soon"),
          },
          {
            label: tStatus("due"),
            value: counts.due,
            icon: Gauge,
            selected: tab === "due",
            onClick: () => selectStatus("due"),
          },
          {
            label: tStatus("overdue"),
            value: counts.overdue,
            icon: AlertTriangle,
            selected: tab === "overdue",
            onClick: () => selectStatus("overdue"),
          },
          {
            // "Needs setup" is both worklists: a program with a rule but no
            // baseline, and a program with no rule at all. They need different
            // actions, which is why the panel below lists them separately.
            label: tStatus("needs_baseline"),
            value: counts.needs_baseline + counts.no_rule,
            icon: Wrench,
            selected: tab === "needs_setup",
            onClick: () => selectStatus("needs_setup"),
          },
        ]}
      />

      <ServiceNeedsSetupPanel
        canManage={canManage}
        setupRows={setupRows}
        noRuleRows={noRuleRows(rows)}
        odometerRows={odometerRows}
        today={today}
        onAddRule={() => setSchedulesOpen(true)}
      />

      <AppListCard>
        <div className="space-y-3 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-[11rem] space-y-1 text-xs">
              <span className="block text-muted-foreground">{t("maintenance.filters.program")}</span>
              <Select
                items={[
                  { value: "all", label: t("filters.any") },
                  ...programOptions.map((entry) => ({ value: entry.key, label: entry.labelEn })),
                ]}
                value={program}
                onValueChange={(next) => setProgram(next ?? "all")}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filters.any")}</SelectItem>
                  {programOptions.map((entry) => (
                    <SelectItem key={entry.key} value={entry.key}>
                      {entry.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(
              [
                [zone, setZone, options.zones, t("maintenance.filters.zone"), "zone"],
                [model, setModel, options.models, t("maintenance.filters.model"), "model"],
                [driver, setDriver, options.drivers, t("maintenance.filters.driver"), "driver"],
              ] as const
            ).map(([selected, setSelected, list, label, key]) => (
              <div key={key} className="w-[11rem] space-y-1 text-xs">
                <span className="block text-muted-foreground">{label}</span>
                <Select
                  items={[
                    { value: "all", label: t("filters.any") },
                    ...list.map((item) => ({ value: item, label: item })),
                  ]}
                  value={selected}
                  onValueChange={(next) => setSelected(next ?? "all")}
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
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={() => router.push("/fleet/service/bikes")}
              >
                {t("bikes.openLink")}
              </Button>
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
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    onClick={() => setImportOpen(true)}
                  >
                    <Upload className="me-1 h-4 w-4" />
                    {t("actions.importBaseline")}
                  </Button>
                  <Button type="button" className="h-9" onClick={() => setSchedulesOpen(true)}>
                    {t("actions.schedules")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    onClick={() => setSyncOpen(true)}
                  >
                    {t("odometerSync.title")}
                  </Button>
                </>
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
              key={`${row.vehicleId}_${row.programKey}`}
              onClick={() => router.push(`/fleet/service?tab=records&vehicle=${row.vehicleId}`)}
            >
              {COLUMNS.map((id) => (
                <TableCell key={id} className="whitespace-nowrap">
                  {id === "status" ? (
                    <Badge variant="outline" className={STATUS_TONE[row.status]}>
                      {tStatus(row.status)}
                    </Badge>
                  ) : id === "actions" ? (
                    // A hand-set due point is a per-vehicle decision, so its door
                    // sits on the row it changes rather than in a toolbar.
                    canManage ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-primary hover:bg-primary/10"
                        aria-label={t("maintenance.setNextDue")}
                        title={t("maintenance.setNextDue")}
                        onClick={(event) => {
                          event.stopPropagation();
                          setNextDue(row);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    ) : null
                  ) : (
                    <span
                      className={
                        id === "plate" || id === "program" ? "font-medium" : "tabular-nums"
                      }
                    >
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

      <ServiceBaselineImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ServiceOdometerSyncDialog open={syncOpen} onOpenChange={setSyncOpen} />
      <ServiceNextDueDialog
        row={nextDue}
        onOpenChange={(open) => {
          if (!open) setNextDue(null);
        }}
      />
    </div>
  );
}
