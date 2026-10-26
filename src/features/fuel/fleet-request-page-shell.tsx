"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { useFleetBreadcrumbs } from "@/features/fleet/use-fleet-breadcrumbs";
import {
  AppListControls,
  FlatListPager,
  GroupedSections,
  GroupTableHeaderRow,
  fieldSearchMatch,
  groupRows,
  useGroupedListView,
  useListControlLabels,
  useListViewPrefs,
} from "@/components/app/app-list-controls";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/dashboard/status-pill";
import {
  DepartmentBadge,
  FuelCompanyBadge,
  HadBeforeBadge,
  ProjectBadge,
} from "@/features/fleet/fleet-badges";
import { isDriverProjectKey, toKuwaitYmd } from "@/features/fleet/fleet-labels";
import { Link } from "@/i18n/navigation";
import { formatKuwaitDayLabel } from "@/lib/date/kuwait-dates";
import { requestStatusLabelKey, requestStatusVariant } from "@/features/requests/request-status-utils";
import { FleetRequestDialog } from "./fleet-request-dialog";
import { type FleetQueueRequestType } from "./fleet-request-utils";
import { formatKwd } from "./fuel-week";
import { useFleetRequests } from "./use-fleet-requests";
import type { FleetRequestListRow } from "./fleet-request-types";

function fleetRequestPrefsKey(type: FleetQueueRequestType): string {
  switch (type) {
    case "fuel":
      return "fuel-requests";
    case "fuel_refund":
      return "fuel-refunds";
    case "asset":
      return "asset-requests";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function FleetRequestPageShell({
  type,
  embedded = false,
}: {
  type: FleetQueueRequestType;
  embedded?: boolean;
}) {
  const t = useTranslations("pages.fleetFuelQueue");
  const withHub = useFleetBreadcrumbs();
  const statusT = useTranslations("pages.requests.status");
  const labels = useListControlLabels();
  const { prefs, update: updateListPrefs } = useListViewPrefs(fleetRequestPrefsKey(type));
  const pageTitle =
    type === "fuel"
      ? t("requestsTitle")
      : type === "fuel_refund"
        ? t("refundsTitle")
        : t("assetsTitle");
  const { data, isPending } = useFleetRequests(type);
  const rows = data?.rows ?? [];
  const isLoading = data === undefined || isPending;
  const [search, setSearch] = useState("");
  const [projectKey, setProjectKey] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isAsset = type === "asset";
  const tableColCount = isAsset ? 14 : 13;

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (
          !fieldSearchMatch(row, search, {
            name: (item) => item.driver_name,
            employee_id: (item) => item.employee_id,
            plate: (item) => item.plate,
            zone: (item) => item.zone,
            status: (item) => item.status,
            code: (item) => item.request_code,
            company: (item) => item.employee_company,
            vehicleCompany: (item) => item.vehicle_company,
            item: (item) => item.item,
          })
        ) {
          return false;
        }
        if (projectKey !== "all" && isDriverProjectKey(projectKey)) {
          return row.project_key === projectKey;
        }
        return true;
      }),
    [projectKey, rows, search],
  );
  const grouped = useMemo(
    () =>
      groupRows(
        visible,
        prefs.groupBy,
        {
          status: (row) => row.status,
          zone: (row) => row.zone,
          project: (row) => row.project_key,
        },
        {},
        "—",
      ),
    [prefs.groupBy, visible],
  );
  const listView = useGroupedListView(
    grouped,
    prefs.groupBy !== "none",
    `${prefs.groupBy}\u0001${search}\u0001${projectKey}`,
  );
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const body = (
    <>
      <AppListCard
        toolbar={
          <AppListControls
            className="min-w-0 flex-1"
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={t("searchPlaceholder")}
            clearSearchLabel={labels.clearSearch}
            groupByOptions={[
              labels.group.none,
              labels.group.status,
              labels.group.zone,
              labels.group.project,
            ]}
            groupBy={prefs.groupBy}
            onGroupByChange={(value) => updateListPrefs({ groupBy: value })}
            groupByLabel={labels.groupBy}
            viewMode={prefs.viewMode}
            onViewModeChange={(value) => updateListPrefs({ viewMode: value })}
            tableViewLabel={labels.viewTable}
            cardsViewLabel={labels.viewCards}
            filterSlot={
              <Select
                items={[
                  { value: "all", label: t("projectAll") },
                  { value: "keeta", label: t("projectKeeta") },
                  { value: "americana", label: t("projectAmericana") },
                ]}
                value={projectKey}
                onValueChange={(value) => {
                  if (value) setProjectKey(value);
                }}
              >
                <SelectTrigger className="h-9 w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" label={t("projectAll")}>
                    {t("projectAll")}
                  </SelectItem>
                  <SelectItem value="keeta" label={t("projectKeeta")}>
                    {t("projectKeeta")}
                  </SelectItem>
                  <SelectItem value="americana" label={t("projectAmericana")}>
                    {t("projectAmericana")}
                  </SelectItem>
                </SelectContent>
              </Select>
            }
          />
        }
      >
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState
            title={type === "fuel" ? t("emptyRequests") : type === "fuel_refund" ? t("emptyRefunds") : t("emptyAssets")}
            description={isAsset ? t("emptyAssetsHint") : t("emptyHint")}
          />
        ) : prefs.viewMode === "cards" ? (
          visible.length === 0 ? (
            <AppEmptyState title={t("emptyFilters")} />
          ) : (
            <div className="p-4">
              <GroupedSections groups={grouped} paged resetKey={`${prefs.groupBy}\u0001${search}\u0001${projectKey}`}>
                {(groupRowsList) => (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {groupRowsList.map((row) => (
                      <button
                        type="button"
                        key={row.id}
                        className="w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/40"
                        onClick={() => setSelectedId(row.id)}
                      >
                        <p className="truncate text-sm font-semibold">{row.request_code}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {row.driver_name}
                          {row.employee_id ? ` · ${row.employee_id}` : ""}
                        </p>
                        <div className="mt-2">
                          <StatusPill dot variant={requestStatusVariant(row.status)}>
                            {statusT(requestStatusLabelKey(row.status) as "pending")}
                          </StatusPill>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </GroupedSections>
            </div>
          )
        ) : (
          <>
          <FlatListPager pager={listView.flatPager} onStep={listView.stepFlat} />
          <AppDataTable
            columns={
              isAsset
                ? [
                    { id: "code", label: t("colRequestId") },
                    { id: "driver", label: t("colEmployee") },
                    { id: "empCompany", label: t("colEmployeeCompany") },
                    { id: "plate", label: t("colPlate") },
                    { id: "vehCompany", label: t("colVehicleCompany") },
                    { id: "project", label: t("colProject") },
                    { id: "zone", label: t("colZone") },
                    { id: "item", label: t("colItem") },
                    { id: "qty", label: t("colQty") },
                    { id: "had", label: t("colHadBefore") },
                    { id: "status", label: t("colStatus") },
                    { id: "step", label: t("colStep") },
                    { id: "date", label: t("colDate") },
                    { id: "actions", label: t("colActions") },
                  ]
                : [
                    { id: "code", label: t("colRequestId") },
                    { id: "driver", label: t("colDriver") },
                    { id: "empCompany", label: t("colEmpCompany") },
                    { id: "vehCompany", label: t("colVehicleCompany") },
                    { id: "fuelCompany", label: t("colFuelCompany") },
                    { id: "project", label: t("colProject") },
                    { id: "zone", label: t("colZone") },
                    { id: "department", label: t("colDepartment") },
                    type === "fuel"
                      ? { id: "requestNo", label: t("colRequestNo") }
                      : { id: "amount", label: t("colAmount") },
                    { id: "status", label: t("colStatus") },
                    { id: "step", label: t("colStep") },
                    { id: "date", label: t("colDate") },
                    { id: "actions", label: t("colActions") },
                  ]
            }
            empty={visible.length === 0 ? <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty> : null}
          >
            {listView.sections.flatMap((section) => [
              ...(section.showHeader
                ? [
                    <GroupTableHeaderRow
                      key={`g-${section.key}`}
                      colSpan={tableColCount}
                      label={section.label}
                      total={section.total}
                      open={section.open}
                      page={section.page}
                      showPager={section.showPager}
                      onToggle={() => listView.toggle(section.key)}
                      onStep={(dir) => listView.step(section.key, dir)}
                    />,
                  ]
                : []),
              ...section.visibleRows.map((row) => (
                <FleetRequestRow
                  key={row.id}
                  row={row}
                  type={type}
                  statusLabel={statusT(requestStatusLabelKey(row.status) as "pending")}
                  onOpen={() => setSelectedId(row.id)}
                />
              )),
            ])}
          </AppDataTable>
          </>
        )}
      </AppListCard>
      <FleetRequestDialog
        open={Boolean(selected)}
        type={type}
        row={selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </>
  );
  if (embedded) return body;
  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={withHub({ label: pageTitle })}
        title={pageTitle}
        description={
          type === "fuel"
            ? t("requestsSubtitle")
            : type === "fuel_refund"
              ? t("refundsSubtitle")
              : t("assetsSubtitle")
        }
      />
      {body}
    </AppPage>
  );
}

function FleetRequestRow({
  row,
  type,
  statusLabel,
  onOpen,
}: {
  row: FleetRequestListRow;
  type: FleetQueueRequestType;
  statusLabel: string;
  onOpen: () => void;
}) {
  const t = useTranslations("pages.fleetFuelQueue");
  return (
    <AppDataTableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell className="whitespace-nowrap font-medium">{row.request_code}</TableCell>
      <TableCell className="whitespace-nowrap">
        <p className="font-medium">{row.driver_name}</p>
        {row.employee_id ? <p className="text-xs text-muted-foreground">{row.employee_id}</p> : null}
        <Link
          href={`/requests/${row.id}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:bg-primary/10"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
          {t("viewDetails")}
        </Link>
      </TableCell>
      <TableCell className="whitespace-nowrap">{row.employee_company ?? "—"}</TableCell>
      {type === "asset" ? (
        <TableCell className="whitespace-nowrap font-medium">{row.plate ?? "—"}</TableCell>
      ) : null}
      <TableCell className="whitespace-nowrap">{row.vehicle_company ?? "—"}</TableCell>
      {type === "asset" ? null : (
        <TableCell>
          <FuelCompanyBadge value={row.fuel_company} />
        </TableCell>
      )}
      <TableCell>
        <ProjectBadge value={row.project_key} />
      </TableCell>
      <TableCell className="whitespace-nowrap">{row.zone ?? "—"}</TableCell>
      {type === "asset" ? (
        <>
          <TableCell className="whitespace-nowrap">{row.item ?? "—"}</TableCell>
          <TableCell className="whitespace-nowrap">{row.quantity ?? "—"}</TableCell>
          <TableCell>
            <HadBeforeBadge value={row.had_before} />
          </TableCell>
        </>
      ) : (
        <>
          <TableCell>
            <DepartmentBadge value={row.department} />
          </TableCell>
          <TableCell className="whitespace-nowrap">
            {type === "fuel" ? row.request_no_this_month : `${formatKwd(row.amount_kwd ?? 0)} KWD`}
          </TableCell>
        </>
      )}
      <TableCell>
        <StatusPill dot variant={requestStatusVariant(row.status)}>
          {statusLabel}
        </StatusPill>
      </TableCell>
      <TableCell className="whitespace-nowrap">{row.current_step_label ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap">{formatKuwaitDayLabel(toKuwaitYmd(row.created_at))}</TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          className="h-9 text-primary hover:bg-primary/10"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <ExternalLink className="me-1.5 h-3.5 w-3.5" />
          {t("open")}
        </Button>
      </TableCell>
    </AppDataTableRow>
  );
}
