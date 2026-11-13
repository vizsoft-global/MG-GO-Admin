"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { usePathname, useRouter as useNextRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, Download, Plus, UserRoundCheck } from "lucide-react";
import { AppListCard } from "@/components/app/app-list-card";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import {
  EmptyCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { VisibleTableCell } from "@/components/app/visible-table-cell";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRouter } from "@/i18n/navigation";
import { formatKwd } from "@/lib/format/money";
import {
  accidentAttachmentCount,
  accidentCaseStatusOf,
  accidentDayOf,
  accidentMatchesSearch,
  computeAccidentKpis,
  filterAccidents,
  isRiderReportAwaitingCompletion,
} from "./accident-model";
import { downloadAccidentsXlsx } from "./accident-xlsx";
import { recordAccidentExport } from "./accident-actions";
import {
  ACCIDENT_CASE_STATUSES,
  ACCIDENT_CASE_STATUS_TONE,
  INSURANCE_CLAIM_STATUSES,
  POLICE_REPORT_STATUSES,
  VEHICLE_CASE_STATUSES,
  type AccidentRow,
} from "./accident-types";
import { useAccidents, useAccidentVehicles } from "./use-accidents";

const COLUMNS = [
  "reference",
  "date",
  "vehicle",
  "driver",
  "case",
  "driverFault",
  "vehicleCase",
  "insuranceClaim",
  "policeReport",
  "amount",
  "documents",
  "source",
  "insuranceCompany",
] as const;

type ColumnId = (typeof COLUMNS)[number];

export function AccidentsPageShell({
  canManage,
  canExport,
}: {
  canManage: boolean;
  canExport: boolean;
}) {
  const t = useTranslations("pages.fleetAccidents");
  const tCase = useTranslations("pages.fleetAccidents.caseStatus");
  const tFault = useTranslations("pages.fleetAccidents.driverFault");
  const tVehicleCase = useTranslations("pages.fleetAccidents.vehicleCaseStatus");
  const tClaim = useTranslations("pages.fleetAccidents.insuranceClaimStatus");
  const tPolice = useTranslations("pages.fleetAccidents.policeReportStatus");
  const tSource = useTranslations("pages.fleetAccidents.source");

  const router = useRouter();
  const nextRouter = useNextRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const accidents = useAccidents();
  const vehicles = useAccidentVehicles();

  const rows = useMemo(() => accidents.data ?? [], [accidents.data]);
  const kpis = computeAccidentKpis(rows);

  const caseFilter = params.get("case") ?? "";
  const sourceFilter = params.get("source") ?? "";
  const vehicleFilter = params.get("vehicle") ?? "";
  const driverFilter = params.get("driver") ?? "";
  const claimFilter = params.get("claim") ?? "";
  const policeFilter = params.get("police") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    nextRouter.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "reference", label: t("cols.reference") },
      { id: "date", label: t("cols.date") },
      { id: "vehicle", label: t("cols.vehicle"), categorical: true },
      { id: "driver", label: t("cols.driver"), categorical: true },
      { id: "case", label: t("cols.case"), categorical: true },
      { id: "driverFault", label: t("cols.driverFault") },
      { id: "vehicleCase", label: t("cols.vehicleCase") },
      { id: "insuranceClaim", label: t("cols.insuranceClaim") },
      { id: "policeReport", label: t("cols.policeReport") },
      { id: "amount", label: t("cols.amount") },
      { id: "documents", label: t("cols.documents") },
      { id: "source", label: t("cols.source"), categorical: true },
      { id: "insuranceCompany", label: t("cols.insuranceCompany"), categorical: true, defaultHidden: true },
    ],
    [t],
  );

  const prefs = useTablePrefs("accident-cases", columns);

  const vehicleLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const vehicle of vehicles.data ?? []) map.set(vehicle.id, vehicle.plate);
    return map;
  }, [vehicles.data]);

  const filtered = useMemo(() => {
    const isCaseStatus =
      caseFilter === "pending" || caseFilter === "delay" || caseFilter === "close";
    const byFilters = filterAccidents(rows, {
      caseStatus: isCaseStatus ? caseFilter : "",
      source: sourceFilter,
      vehicleId: vehicleFilter,
      driverId: driverFilter,
      from,
      to,
      insuranceClaimStatus: claimFilter,
      policeReportStatus: policeFilter,
    });
    const byCase =
      caseFilter === "open"
        ? byFilters.filter((row) => accidentCaseStatusOf(row) !== "close")
        : caseFilter === "awaiting"
          ? byFilters.filter((row) => isRiderReportAwaitingCompletion(row))
          : byFilters;
    return byCase.filter((row) =>
      accidentMatchesSearch(row, prefs.appliedQuery, vehicleLabel.get(row.vehicle_id)),
    );
  }, [
    rows,
    caseFilter,
    sourceFilter,
    vehicleFilter,
    driverFilter,
    from,
    to,
    claimFilter,
    policeFilter,
    prefs.appliedQuery,
    vehicleLabel,
  ]);

  const caseItems = (["all", ...ACCIDENT_CASE_STATUSES] as const).map((id) => ({
    id,
    label:
      id === "all"
        ? `${t("filters.all")} (${kpis.total})`
        : `${tCase(id)} (${kpis[id]})`,
  }));

  function cell(columnId: ColumnId, row: AccidentRow): ReactNode {
    switch (columnId) {
      case "reference":
        return row.reference ? (
          <span className="font-medium tabular-nums">{row.reference}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{t("legacyRow")}</span>
        );
      case "date":
        return <span className="tabular-nums">{accidentDayOf(row) || "—"}</span>;
      case "vehicle":
        return (
          <span className="whitespace-nowrap">
            {row.plate_snapshot ?? vehicleLabel.get(row.vehicle_id) ?? "—"}
          </span>
        );
      case "driver":
        return row.driver_name ? (
          <span className="whitespace-nowrap">{row.driver_name}</span>
        ) : (
          <EmptyCell />
        );
      case "case": {
        const status = accidentCaseStatusOf(row);
        return (
          <Badge variant="outline" className={ACCIDENT_CASE_STATUS_TONE[status]}>
            {tCase(status)}
          </Badge>
        );
      }
      case "driverFault":
        return row.driver_fault ? tFault(row.driver_fault) : <EmptyCell />;
      case "vehicleCase":
        return row.vehicle_case_status ? tVehicleCase(row.vehicle_case_status) : <EmptyCell />;
      case "insuranceClaim":
        return row.insurance_claim_status ? tClaim(row.insurance_claim_status) : <EmptyCell />;
      case "policeReport":
        return row.police_report_status ? tPolice(row.police_report_status) : <EmptyCell />;
      case "amount":
        return row.amount_kwd == null ? (
          <EmptyCell />
        ) : (
          <span className="tabular-nums">{formatKwd(row.amount_kwd)}</span>
        );
      case "documents": {
        const count = accidentAttachmentCount(row);
        return count === 0 ? (
          <EmptyCell />
        ) : (
          <span className="tabular-nums">{count}</span>
        );
      }
      case "source":
        return <Badge variant="outline">{tSource(row.source)}</Badge>;
      case "insuranceCompany":
        return row.insurance_company ? row.insurance_company : <EmptyCell />;
      default:
        return null;
    }
  }

  const grouped = prefs.groupBy !== "none";
  const sections = useMemo(() => {
    if (!grouped) return [{ key: "all", label: "", rows: filtered }];
    const keyOf = (row: AccidentRow): string => {
      switch (prefs.groupBy) {
        case "case":
          return tCase(accidentCaseStatusOf(row));
        case "source":
          return tSource(row.source);
        case "vehicle":
          return row.plate_snapshot ?? vehicleLabel.get(row.vehicle_id) ?? t("filters.any");
        case "driver":
          return row.driver_name ?? t("filters.any");
        case "insuranceCompany":
          return row.insurance_company ?? t("filters.any");
        default:
          return "";
      }
    };
    const map = new Map<string, AccidentRow[]>();
    for (const row of filtered) {
      const key = keyOf(row);
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, groupRows]) => ({ key, label: key, rows: groupRows }));
  }, [filtered, grouped, prefs.groupBy, tCase, tSource, t, vehicleLabel]);

  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));


  return (
    <AppPage className="space-y-3">
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[{ label: t("title") }]}
        actions={
          <>
            {canExport ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 cursor-pointer rounded-lg"
                disabled={filtered.length === 0}
                onClick={() => {
                  void downloadAccidentsXlsx(filtered, {
                    caseStatus: (status) => tCase(status),
                    source: (source) => tSource(source),
                    driverFault: (key) => tFault(key),
                    vehicleCase: (key) =>
                      tVehicleCase(key as (typeof VEHICLE_CASE_STATUSES)[number]),
                    insuranceClaim: (key) => tClaim(key as (typeof INSURANCE_CLAIM_STATUSES)[number]),
                    policeReport: (key) => tPolice(key as (typeof POLICE_REPORT_STATUSES)[number]),
                  });
                  void recordAccidentExport(filtered.length);
                }}
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
                onClick={() => router.push("/fleet/accident/new")}
              >
                <Plus className="me-1.5 h-3.5 w-3.5" />
                {t("actions.add")}
              </Button>
            ) : null}
          </>
        }
      />
      <KpiGrid
        compact
        items={[
          {
            label: t("kpi.open"),
            value: kpis.open,
            icon: AlertTriangle,
            accent: "warning",
            selected: caseFilter === "open",
            onClick: () => setParam("case", caseFilter === "open" ? "" : "open"),
          },
          {
            label: tCase("pending"),
            value: kpis.pending,
            icon: Clock,
            selected: caseFilter === "pending",
            onClick: () => setParam("case", caseFilter === "pending" ? "" : "pending"),
          },
          {
            label: tCase("delay"),
            value: kpis.delay,
            icon: AlertTriangle,
            accent: "danger",
            selected: caseFilter === "delay",
            onClick: () => setParam("case", caseFilter === "delay" ? "" : "delay"),
          },
          {
            label: tCase("close"),
            value: kpis.close,
            icon: CheckCircle2,
            selected: caseFilter === "close",
            onClick: () => setParam("case", caseFilter === "close" ? "" : "close"),
          },
          {
            label: t("kpi.riderAwaiting"),
            value: kpis.riderAwaiting,
            icon: UserRoundCheck,
            selected: caseFilter === "awaiting",
            onClick: () => setParam("case", caseFilter === "awaiting" ? "" : "awaiting"),
          },
          {
            label: t("kpi.total"),
            value: kpis.total,
            icon: ClipboardList,
            selected: caseFilter === "",
            onClick: () => setParam("case", ""),
          },
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
            <div className="w-[11rem] space-y-1 text-xs">
              <span className="block text-muted-foreground">{t("filters.source")}</span>
              <Select
                items={[
                  { value: "all", label: t("filters.any") },
                  { value: "admin", label: tSource("admin") },
                  { value: "rider", label: tSource("rider") },
                ]}
                value={sourceFilter || "all"}
                onValueChange={(value) => setParam("source", value && value !== "all" ? value : "")}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("filters.source")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filters.any")}</SelectItem>
                  <SelectItem value="admin">{tSource("admin")}</SelectItem>
                  <SelectItem value="rider">{tSource("rider")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-[12rem] space-y-1 text-xs">
              <span className="block text-muted-foreground">{t("cols.insuranceClaim")}</span>
              <Select
                items={[
                  { value: "all", label: t("filters.any") },
                  ...INSURANCE_CLAIM_STATUSES.map((key) => ({ value: key, label: tClaim(key) })),
                ]}
                value={claimFilter || "all"}
                onValueChange={(value) => setParam("claim", value && value !== "all" ? value : "")}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("filters.any")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filters.any")}</SelectItem>
                  {INSURANCE_CLAIM_STATUSES.map((key) => (
                    <SelectItem key={key} value={key}>
                      {tClaim(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[12rem] space-y-1 text-xs">
              <span className="block text-muted-foreground">{t("cols.policeReport")}</span>
              <Select
                items={[
                  { value: "all", label: t("filters.any") },
                  ...POLICE_REPORT_STATUSES.map((key) => ({ value: key, label: tPolice(key) })),
                ]}
                value={policeFilter || "all"}
                onValueChange={(value) => setParam("police", value && value !== "all" ? value : "")}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder={t("filters.any")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filters.any")}</SelectItem>
                  {POLICE_REPORT_STATUSES.map((key) => (
                    <SelectItem key={key} value={key}>
                      {tPolice(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <TabBar
            items={caseItems}
            activeId={caseFilter || "all"}
            onSelect={(id) => setParam("case", id === "all" ? "" : id)}
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
                  onClick={() => router.push(`/fleet/accident/${row.id}`)}
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
          <span>{t("attachmentsHint")}</span>
        </div>
      </AppListCard>
    </AppPage>
  );
}

