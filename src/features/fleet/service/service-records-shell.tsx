"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { usePathname, useRouter as useNextRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, ClipboardList, Download, Hash, Plus, Wallet } from "lucide-react";
import { AppListCard } from "@/components/app/app-list-card";
import { Button } from "@/components/ui/button";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  EmptyCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { VisibleTableCell } from "@/components/app/visible-table-cell";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { formatKwd } from "@/lib/format/money";
import {
  effectiveRecordCost,
  isDoneRecord,
  openCount,
  recordDay,
  recordStage,
  stageCounts,
} from "./service-records-model";
import { downloadServiceRecordsXlsx } from "./service-records-xlsx";
import { plausibleCost } from "./service-reports-model";
import { categoryTone } from "./service-types";
import { useServiceRecords, useServiceTypeCatalog, useServiceVehicles } from "./use-service";
import type { ServiceRecordRow, ServiceStage } from "./types";

const COLUMNS = [
  "date",
  "description",
  "type",
  "vehicle",
  "driver",
  "employee",
  "vendor",
  "company",
  "cost",
  "odometer",
  "stage",
] as const;

type ColumnId = (typeof COLUMNS)[number];

const STAGE_TONE: Record<ServiceStage, string> = {
  new: "border-sky-200 bg-sky-50 text-sky-800",
  running: "border-amber-200 bg-amber-50 text-amber-800",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-border bg-muted text-muted-foreground",
};

export function ServiceRecordsShell({
  canManage,
  canExport,
}: {
  canManage: boolean;
  canExport: boolean;
}) {
  const t = useTranslations("pages.fleetService");
  const tStage = useTranslations("pages.fleetService.stages");
  const router = useRouter();
  const nextRouter = useNextRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const records = useServiceRecords();
  const vehicles = useServiceVehicles();
  const types = useServiceTypeCatalog();

  const rows = useMemo(() => records.data ?? [], [records.data]);
  const month = kuwaitTodayYmd().slice(0, 7);

  const stageFilter = params.get("stage") ?? "all";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const vehicleFilter = params.get("vehicle") ?? "";
  const typeFilter = params.get("type") ?? "";
  const categoryFilter = params.get("category") ?? "";
  const vendorFilter = params.get("vendor") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    nextRouter.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "date", label: t("cols.date") },
      { id: "description", label: t("cols.description") },
      { id: "type", label: t("cols.type"), categorical: true },
      { id: "vehicle", label: t("cols.vehicle"), categorical: true },
      { id: "driver", label: t("cols.driver"), categorical: true },
      { id: "employee", label: t("cols.employeeId"), categorical: true },
      { id: "vendor", label: t("cols.vendor"), categorical: true },
      { id: "company", label: t("cols.company"), defaultHidden: true },
      { id: "cost", label: t("cols.cost") },
      { id: "odometer", label: t("cols.odometer") },
      { id: "stage", label: t("cols.stage"), categorical: true },
    ],
    [t],
  );

  const prefs = useTablePrefs("service-records", columns);
  const counts = stageCounts(rows);

  const vehicleLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const vehicle of vehicles.data ?? []) map.set(vehicle.id, vehicle.plate);
    return map;
  }, [vehicles.data]);

  const filtered = useMemo(() => {
    const term = prefs.appliedQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (stageFilter !== "all" && recordStage(row) !== stageFilter) return false;
      const day = recordDay(row);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (vehicleFilter && row.vehicle_id !== vehicleFilter) return false;
      if (typeFilter && (row.service_type_key ?? "") !== typeFilter) return false;
      if (categoryFilter && (row.category ?? "") !== categoryFilter) return false;
      if (vendorFilter && (row.vendor ?? "") !== vendorFilter) return false;
      if (!term) return true;
      return [
        day,
        row.description,
        row.service_type_label,
        row.vehicle_snapshot?.plate,
        vehicleLabel.get(row.vehicle_id),
        row.driver_name,
        row.employee_id,
        row.vendor,
        row.company,
        row.invoice_no,
        row.stage,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [
    rows,
    prefs.appliedQuery,
    stageFilter,
    from,
    to,
    vehicleFilter,
    typeFilter,
    categoryFilter,
    vendorFilter,
    vehicleLabel,
  ]);

  const doneThisMonth = rows.filter(
    (row) => isDoneRecord(row) && recordDay(row).slice(0, 7) === month,
  );
  const costThisMonth = doneThisMonth.reduce((sum, row) => sum + plausibleCost(effectiveRecordCost(row)), 0);

  const stageItems = (["all", "new", "running", "done", "cancelled"] as const).map((id) => ({
    id,
    label: `${tStage(id)} (${id === "all" ? counts.all : counts[id]})`,
  }));

  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

  const grouped = prefs.groupBy !== "none";

  const sections = useMemo(() => {
    if (!grouped) return [{ key: "all", label: "", rows: filtered }];
    const keyOf = (row: ServiceRecordRow): string => {
      switch (prefs.groupBy) {
        case "stage":
          return tStage(recordStage(row));
        case "type":
          return row.service_type_label ?? row.kind ?? "—";
        case "vehicle":
          return row.vehicle_snapshot?.plate ?? vehicleLabel.get(row.vehicle_id) ?? "—";
        case "driver":
          return row.driver_name ?? "—";
        case "vendor":
          return row.vendor ?? "—";
        case "date":
          return recordDay(row) || "—";
        default:
          return "";
      }
    };
    const map = new Map<string, ServiceRecordRow[]>();
    for (const row of filtered) {
      const key = keyOf(row);
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, rows]) => ({ key, label: key, rows }));
  }, [filtered, grouped, prefs.groupBy, tStage, vehicleLabel]);

  function cell(columnId: ColumnId, row: ServiceRecordRow): ReactNode {
    switch (columnId) {
      case "date":
        return recordDay(row) || "—";
      case "description":
        return row.description ? row.description : <EmptyCell />;
      case "type": {
        const label = row.service_type_label ?? row.kind;
        if (!label) return <EmptyCell />;
        return (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${categoryTone(row.category)}`}
          >
            {label}
          </span>
        );
      }
      case "vehicle":
        return (
          <span className="whitespace-nowrap">
            {row.vehicle_snapshot?.plate ?? vehicleLabel.get(row.vehicle_id) ?? "—"}
          </span>
        );
      case "driver":
        return row.driver_name ? row.driver_name : <EmptyCell />;
      case "employee":
        return row.employee_id ? (
          <span className="tabular-nums">{row.employee_id}</span>
        ) : (
          <EmptyCell />
        );
      case "vendor":
        return row.vendor ? row.vendor : <EmptyCell />;
      case "company":
        return row.company ? row.company : <EmptyCell />;
      case "cost":
        return (
          <span className="tabular-nums">{formatKwd(effectiveRecordCost(row))}</span>
        );
      case "odometer":
        return <span className="tabular-nums">{row.odometer_km ?? row.odometer ?? "—"}</span>;
      case "stage": {
        const stage = recordStage(row);
        return (
          <Badge variant="outline" className={STAGE_TONE[stage]}>
            {tStage(stage)}
          </Badge>
        );
      }
      default:
        return null;
    }
  }


  return (
    <div className="space-y-3">
      <KpiGrid
        compact
        items={[
          { label: t("kpi.total"), value: counts.all, icon: ClipboardList },
          { label: t("kpi.open"), value: openCount(counts), icon: AlertTriangle, accent: "warning" },
          { label: t("kpi.doneThisMonth"), value: doneThisMonth.length, icon: CheckCircle2 },
          { label: t("kpi.costThisMonth"), value: formatKwd(costThisMonth), icon: Wallet },
          { label: t("kpi.types"), value: types.data?.length ?? 0, icon: Hash },
        ]}
      />

      <AppListCard>
        <div className="space-y-3 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">{t("filters.from")}</span>
              <Input
                type="date"
                className="h-9 w-[9.5rem]"
                value={from}
                onChange={(event) => setParam("from", event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">{t("filters.to")}</span>
              <Input
                type="date"
                className="h-9 w-[9.5rem]"
                value={to}
                onChange={(event) => setParam("to", event.target.value)}
              />
            </label>
            <div className="w-[11rem] space-y-1 text-xs">
              <span className="block text-muted-foreground">{t("filters.vehicle")}</span>
              <Select
                items={[
                  { value: "all", label: t("filters.any") },
                  ...(vehicles.data ?? []).map((vehicle) => ({
                    value: vehicle.id,
                    label: vehicle.plate,
                  })),
                ]}
                value={vehicleFilter || "all"}
                onValueChange={(value) => setParam("vehicle", value && value !== "all" ? value : "")}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("filters.vehicle")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filters.any")}</SelectItem>
                  {(vehicles.data ?? []).map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.plate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[12rem] space-y-1 text-xs">
              <span className="block text-muted-foreground">{t("filters.type")}</span>
              <Select
                items={[
                  { value: "all", label: t("filters.any") },
                  ...(types.data ?? []).map((type) => ({ value: type.key, label: type.label_en })),
                ]}
                value={typeFilter || "all"}
                onValueChange={(value) => setParam("type", value && value !== "all" ? value : "")}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("filters.type")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filters.any")}</SelectItem>
                  {(types.data ?? []).map((type) => (
                    <SelectItem key={type.key} value={type.key}>
                      {type.label_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {vendorFilter || categoryFilter ? (
              <button
                type="button"
                className="h-9 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted/60"
                onClick={() => {
                  setParam("vendor", "");
                  setParam("category", "");
                }}
              >
                {t("filters.any")}
              </button>
            ) : null}
            <div className="ms-auto flex items-center gap-2">
              {canExport ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 cursor-pointer rounded-lg"
                  disabled={filtered.length === 0}
                  onClick={() =>
                    void downloadServiceRecordsXlsx(filtered, {
                      labelForStage: (stage) => tStage(stage),
                    })
                  }
                >
                  <Download className="me-1.5 h-3.5 w-3.5" />
                  {t("actions.export")}
                </Button>
              ) : null}
              {canManage ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-9 cursor-pointer rounded-lg"
                  onClick={() => router.push("/fleet/service/records/new")}
                >
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                  {t("actions.add")}
                </Button>
              ) : null}
            </div>
          </div>
          <TabBar
            items={stageItems}
            activeId={stageFilter}
            onSelect={(id) => setParam("stage", id === "all" ? "" : id)}
          />
        </div>

        <AppDataTable
          toolbar={
            <TableToolbar
              prefs={prefs}
              entity={t("title")}
              columns={columns}
              rowKind="dynamic"
              filteredCount={filtered.length}
              totalCount={rows.length}
            />
          }
          columns={shown.map((column) => ({ id: column.id, label: column.label }))}
          empty={
            filtered.length === 0 ? (
              <AppDataTableEmpty>
                <AppEmptyState title={t("emptyTitle")} description={t("emptyHint")} />
              </AppDataTableEmpty>
            ) : null
          }
        >
          {sections.map((section) => (
            <Fragment key={section.key}>
              {grouped ? (
                <AppDataTableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={shown.length}
                    className="bg-muted/40 py-2 text-xs font-semibold text-foreground"
                  >
                    {section.label}
                    <span className="ms-2 rounded-full bg-muted px-1.5 tabular-nums text-muted-foreground">
                      {section.rows.length}
                    </span>
                  </TableCell>
                </AppDataTableRow>
              ) : null}
              {section.rows.map((row) => (
                <AppDataTableRow
                  key={row.id}
                  onClick={() => router.push(`/fleet/service/records/${row.id}`)}
                >
                  {shown.map((column) =>
                    COLUMNS.includes(column.id as ColumnId) ? (
                      <VisibleTableCell
                        key={column.id}
                        columnId={column.id}
                        isVisible={prefs.isVisible}
                        className="whitespace-nowrap"
                      >
                        {cell(column.id as ColumnId, row)}
                      </VisibleTableCell>
                    ) : null,
                  )}
                </AppDataTableRow>
              ))}
            </Fragment>
          ))}
        </AppDataTable>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span>{t("showing", { shown: filtered.length, total: rows.length })}</span>
          <Link
            href={{ pathname: "/fleet/service", query: { tab: "maintenance" } }}
            className="text-xs font-medium text-primary hover:underline"
          >
            {t("kpi.overdueLink")}
          </Link>
        </div>
      </AppListCard>
    </div>
  );
}

