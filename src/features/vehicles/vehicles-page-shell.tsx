"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Bike,
  Car,
  CircleDot,
  Download,
  ExternalLink,
  FilterX,
  Loader2,
  Plus,
  RefreshCw,
  Repeat,
  Upload,
  UserX,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { useFleetBreadcrumbs } from "@/features/fleet/use-fleet-breadcrumbs";
import {
  AppListControls,
  FlatListPager,
  GroupedSections,
  GroupTableHeaderRow,
  groupRows,
  scopeSelectionState,
  toggleScopeSelection,
  useGroupedListView,
  useListControlLabels,
  useListViewPrefs,
} from "@/components/app/app-list-controls";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  AppTableColumnPicker,
  VisibleTableCell,
} from "@/components/app";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TableCell } from "@/components/ui/table";
import { CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MetricTile, type Tone } from "@/components/ui/metric-tile";
import { useAuth } from "@/contexts/auth-context";
import { useTableColumnVisibility } from "@/hooks/use-table-column-visibility";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/query-keys";
import {
  CarTypeBadge,
  ConditionBadge,
  FuelCompanyBadge,
  FuelTypeBadge,
  KindBadge,
  ProjectBadge,
  ReplacementBadge,
  VehicleStatusBadge,
} from "@/features/fleet/fleet-badges";
import { formatReplacementSince, isVehicleTypeOfUse } from "@/features/fleet/fleet-labels";
import { useTypeLabel } from "./vehicle-use-types";
import { VehicleBulkImportDialog } from "./import/vehicle-bulk-import-dialog";
import { downloadVehicleListXlsx } from "./import/vehicle-import-sheet";
import { ClearAllModuleButton } from "@/features/settings/clear-all-module-button";
import { VehicleBulkBar } from "./vehicle-bulk-bar";
import { VehicleFormDialog } from "./vehicle-form-dialog";
import { VehiclesColumnHeader } from "./vehicles-column-header";
import {
  useVehicleCompanies,
  useVehicleTypes,
  useVehicleUseTypes,
  useVehiclesList,
} from "./use-vehicles";
import type { VehicleListRow } from "./types";
import {
  countActiveFilters,
  DEFAULT_VEHICLES_SORT,
  nextSort,
  rowMatchesColumnFilters,
  sortVehicles,
  uniqueColumnValues,
  VEHICLE_COLUMN_KINDS,
  vehiclesFilterKind,
  withColumnFilter,
  type VehiclesColumnFilters,
  type VehiclesFixedColumn,
  type VehiclesSort,
} from "./vehicles-list-query";
import {
  applyVehicleKpi,
  parseVehicleListTab,
  vehicleKpiSelected,
  vehicleListKpis,
  vehicleMatchesAssignment,
  vehicleMatchesCarType,
  vehicleMatchesKind,
  vehicleMatchesProject,
  vehicleMatchesReplacement,
  vehicleMatchesSearch,
  vehicleMatchesStatus,
  vehicleMatchesTab,
  vehicleMatchesTypeOfUse,
  type VehicleAssignmentFilter,
  type VehicleCarTypeFilter,
  type VehicleKindFilter,
  type VehicleKpiKey,
  type VehicleListTab,
  type VehicleProjectFilter,
  type VehicleReplacementFilter,
  type VehicleStatusFilter,
  type VehicleTypeOfUseFilter,
} from "./vehicles-list-utils";

const COLUMN_ORDER = Object.keys(VEHICLE_COLUMN_KINDS) as VehiclesFixedColumn[];
const COLUMN_LABEL_KEYS: Record<VehiclesFixedColumn, string> = {
  plate: "colPlate",
  chassis: "colChassis",
  kind: "colKind",
  model: "colModel",
  year: "colYear",
  condition: "colCondition",
  chip: "colChip",
  fuelType: "colFuelType",
  fuelCompany: "colFuelCompany",
  carsCompany: "colCarsCompany",
  project: "colProject",
  typeOfUse: "colTypeOfUse",
  company: "colVehicleCompany",
  location: "colLocation",
  driver: "colDriver",
  empCompany: "colEmpCompany",
  carType: "colCarType",
  replacement: "colReplacement",
  repPlate: "colRepPlate",
  since: "colSince",
};

export function VehiclesPageShell({
  addOpen,
  tab,
}: {
  addOpen: boolean;
  tab?: string;
}) {
  const t = useTranslations("pages.vehicles");
  const withHub = useFleetBreadcrumbs();
  const locale = useLocale();
  const { can } = useAuth();
  const canCreate = can("vehicles.create");
  const canManage = can("vehicles.manage");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: vehicles = [], isLoading, isFetching, refetch } = useVehiclesList();
  const { data: types = [] } = useVehicleTypes();
  const { data: useTypes = [] } = useVehicleUseTypes();
  const { data: companies = [] } = useVehicleCompanies();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const labels = useListControlLabels();
  const { prefs, update: updateListPrefs } = useListViewPrefs("vehicles");
  const [projectFilter, setProjectFilter] = useState<VehicleProjectFilter>("all");
  const [statusFilter, setStatusFilter] = useState<VehicleStatusFilter>("all");
  const [carTypeFilter, setCarTypeFilter] = useState<VehicleCarTypeFilter>("all");
  const [typeOfUseFilter, setTypeOfUseFilter] = useState<VehicleTypeOfUseFilter>("all");
  const [kindFilter, setKindFilter] = useState<VehicleKindFilter>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<VehicleAssignmentFilter>("all");
  const [replacementFilter, setReplacementFilter] = useState<VehicleReplacementFilter>("all");
  const [columnFilters, setColumnFilters] = useState<VehiclesColumnFilters>({});
  const [sort, setSort] = useState<VehiclesSort>(DEFAULT_VEHICLES_SORT);
  const [importOpen, setImportOpen] = useState(false);
  const activeTab = parseVehicleListTab(tab);

  useEffect(() => {
    const company = searchParams.get("company");
    if (!company) return;
    setColumnFilters((prev) => ({ ...prev, company: { in: [company] } }));
  }, [searchParams]);
  const filterState = {
    tab: activeTab,
    status: statusFilter,
    carType: carTypeFilter,
    typeOfUse: typeOfUseFilter,
    kind: kindFilter,
    search,
    project: projectFilter,
    assignment: assignmentFilter,
    replacement: replacementFilter,
  };

  const columnOptions = useMemo(
    () =>
      COLUMN_ORDER.map((id) => ({
        id,
        label: t(COLUMN_LABEL_KEYS[id] as "colPlate"),
        locked: id === "plate",
        defaultVisible: id !== "company",
      })),
    [t],
  );
  const { isVisible, toggle, reset, pickerOptions, hiddenToggleableCount } =
    useTableColumnVisibility("dpd:vehicles:list-columns", columnOptions);

  const replaceQuery = (next: { add?: boolean; tab?: VehicleListTab }) => {
    const params = new URLSearchParams();
    const nextTab = next.tab ?? activeTab;
    const nextAdd = next.add ?? addOpen;
    if (nextTab !== "all") params.set("tab", nextTab);
    if (nextAdd) params.set("add", "1");
    const qs = params.toString();
    router.replace(qs ? `/vehicles?${qs}` : "/vehicles");
  };

  const scoped = useMemo(
    () =>
      vehicles.filter(
        (row) =>
          vehicleMatchesTab(row, activeTab) &&
          vehicleMatchesStatus(row, statusFilter) &&
          vehicleMatchesCarType(row, carTypeFilter) &&
          vehicleMatchesTypeOfUse(row, typeOfUseFilter) &&
          vehicleMatchesKind(row, kindFilter) &&
          vehicleMatchesProject(row, projectFilter) &&
          vehicleMatchesAssignment(row, assignmentFilter) &&
          vehicleMatchesReplacement(row, replacementFilter) &&
          vehicleMatchesSearch(row, search, "all"),
      ),
    [
      activeTab,
      assignmentFilter,
      carTypeFilter,
      kindFilter, projectFilter,
      replacementFilter,
      search,
      statusFilter,
      typeOfUseFilter,
      vehicles,
    ],
  );

  const visible = useMemo(
    () => sortVehicles(scoped.filter((row) => rowMatchesColumnFilters(row, columnFilters)), sort),
    [columnFilters, scoped, sort],
  );

  const groupedVehicles = useMemo(
    () =>
      groupRows(
        visible,
        prefs.groupBy,
        {
          status: (row) => row.status,
          project: (row) => row.assigned_project_key,
        },
        {},
        "—",
      ),
    [prefs.groupBy, visible],
  );
  const vehicleResetKey = `${prefs.groupBy}\u0001${JSON.stringify(filterState)}\u0001${JSON.stringify(columnFilters)}`;
  const listView = useGroupedListView(groupedVehicles, prefs.groupBy !== "none", vehicleResetKey);
  const vehicleResetSeen = useRef(vehicleResetKey);
  useEffect(() => {
    if (vehicleResetSeen.current === vehicleResetKey) return;
    vehicleResetSeen.current = vehicleResetKey;
    setSelectedIds(new Set());
  }, [vehicleResetKey]);

  const applyKpi = (key: VehicleKpiKey) => {
    const next = applyVehicleKpi(key, filterState);
    setStatusFilter(next.status);
    setCarTypeFilter(next.carType);
    setTypeOfUseFilter(next.typeOfUse);
    setKindFilter(next.kind);
    setSearch(next.search);
    setProjectFilter(next.project);
    setAssignmentFilter(next.assignment);
    setReplacementFilter(next.replacement);
    if (next.tab !== activeTab) replaceQuery({ tab: next.tab });
  };

  const clearAll = () => {
    setSearch("");
    setProjectFilter("all");
    setStatusFilter("all");
    setCarTypeFilter("all");
    setTypeOfUseFilter("all");
    setKindFilter("all");
    setAssignmentFilter("all");
    setReplacementFilter("all");
    setColumnFilters({});
    setSort(DEFAULT_VEHICLES_SORT);
    if (activeTab !== "all") replaceQuery({ tab: "all" });
  };

  const counts = useMemo(() => vehicleListKpis(vehicles), [vehicles]);
  const kpiExtras =
    (projectFilter !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (carTypeFilter !== "all" ? 1 : 0) +
    (typeOfUseFilter !== "all" ? 1 : 0) +
    (kindFilter !== "all" ? 1 : 0) +
    (assignmentFilter !== "all" ? 1 : 0) +
    (replacementFilter !== "all" ? 1 : 0);
  const activeFilterCount = countActiveFilters(columnFilters) + (search ? 1 : 0) + kpiExtras;
  const headerLabels = useMemo(
    () => ({
      search: t("colFilterSearch"),
      contains: t("colFilterContains"),
      all: t("colFilterAll"),
      clear: t("colFilterClear"),
      apply: t("colFilterApply"),
      min: t("colFilterMin"),
      max: t("colFilterMax"),
      noOptions: t("colFilterEmpty"),
      sortBy: (label: string) => t("colSortBy", { label }),
      filterBy: (label: string) => t("colFilterBy", { label }),
    }),
    [t],
  );
  const optionLabel = useCallback(
    (column: VehiclesFixedColumn, value: string) => {
      if (column === "kind") return value === "car" ? t("kindCar") : t("kindBike");
      if (column === "condition") return t(`condition.${value}` as "condition.running");
      if (column === "fuelType") return t(`fuelType.${value}` as "fuelType.chip");
      if (column === "fuelCompany") return t(`fuelCompany.${value}` as "fuelCompany.mus");
      if (column === "carType") return t(`carType.${value}` as "carType.company");
      if (column === "typeOfUse") {
        if (isVehicleTypeOfUse(value)) return t(`typeOfUse.${value}`);
        return useTypeLabel(value, useTypes, locale);
      }
      if (column === "company") {
        const company = companies.find((item) => item.key === value);
        if (!company) return value;
        return locale.startsWith("ar")
          ? company.label_ar || company.label_en
          : company.label_en;
      }
      if (column === "project") {
        if (value === "keeta") return t("projectKeeta");
        if (value === "americana") return t("projectAmericana");
        return value;
      }
      if (column === "replacement") return value === "yes" ? t("replacementBanner") : t("replacementNo");
      return value;
    },
    [companies, locale, t, useTypes],
  );

  const tabSelectItems = useMemo(
    () => [
      { value: "all" as const, label: t("tabAll") },
      { value: "suspended" as const, label: t("tabSuspended") },
      { value: "on-duty" as const, label: t("tabOnDuty") },
    ],
    [t],
  );

  const kpis: { key: VehicleKpiKey; label: string; value: string; icon: typeof Bike; tone: Tone }[] = [
    { key: "total", label: t("kpiTotal"), value: isLoading ? "—" : String(counts.total), icon: Bike, tone: "primary" },
    { key: "onDuty", label: t("kpiOnDuty"), value: isLoading ? "—" : String(counts.onDuty), icon: CircleDot, tone: "success" },
    { key: "suspended", label: t("kpiSuspended"), value: isLoading ? "—" : String(counts.suspended), icon: Ban, tone: "danger" },
    { key: "company", label: t("kpiCompany"), value: isLoading ? "—" : String(counts.company), icon: Users, tone: "primary" },
    { key: "rent", label: t("kpiRent"), value: isLoading ? "—" : String(counts.rent), icon: Wallet, tone: "warning" },
    { key: "underRepair", label: t("kpiUnderRepair"), value: isLoading ? "—" : String(counts.underRepair), icon: Wrench, tone: "warning" },
    { key: "unassigned", label: t("kpiUnassigned"), value: isLoading ? "—" : String(counts.unassigned), icon: UserX, tone: "warning" },
    { key: "bike", label: t("kpiBike"), value: isLoading ? "—" : String(counts.bike), icon: Bike, tone: "primary" },
    { key: "car", label: t("kpiCar"), value: isLoading ? "—" : String(counts.car), icon: Car, tone: "primary" },
    { key: "active", label: t("kpiActive"), value: isLoading ? "—" : String(counts.active), icon: CircleDot, tone: "success" },
    { key: "replacement", label: t("kpiReplacement"), value: isLoading ? "—" : String(counts.replacement), icon: Repeat, tone: "warning" },
  ];

  const scopeIds = useMemo(() => listView.scopeRows.map((row) => row.id), [listView.scopeRows]);
  const headerSelection = scopeSelectionState(selectedIds, scopeIds);
  const selectedRows = useMemo(
    () => vehicles.filter((row) => selectedIds.has(row.id)),
    [selectedIds, vehicles],
  );

  const tableColumns = useMemo(
    () =>
      [
        ...(canManage
          ? [
              {
                id: "select",
                className: "w-10",
                label: (
                  <Checkbox
                    checked={headerSelection === "all"}
                    indeterminate={headerSelection === "some"}
                    onCheckedChange={() => {
                      setSelectedIds((prev) => toggleScopeSelection(prev, scopeIds));
                    }}
                    aria-label={t("bulkSelected", { count: scopeIds.length })}
                  />
                ),
              },
            ]
          : []),
        ...COLUMN_ORDER.filter((id) => isVisible(id)).map((id) => ({
        id,
        label: (
          <VehiclesColumnHeader
            column={id}
            label={t(COLUMN_LABEL_KEYS[id] as "colPlate")}
            kind={vehiclesFilterKind(id) ?? "text"}
            filter={columnFilters[id]}
            onApply={(next) => setColumnFilters((prev) => withColumnFilter(prev, id, next))}
            sort={sort}
            onSort={() => setSort((prev) => nextSort(prev, id))}
            options={uniqueColumnValues(scoped, id)}
            optionLabel={(value) => optionLabel(id, value)}
            labels={headerLabels}
          />
        ),
      })),
      ],
    [headerSelection, canManage, columnFilters, headerLabels, isVisible, optionLabel, scoped, sort, t, scopeIds],
  );

  const isRefreshing = isFetching && !isLoading;

  return (
    <AppPage>
      <AppPageHeader
        breadcrumbs={withHub({ label: t("title") })}
        title={t("title")}
        description={t("subtitle")}
        actions={<ClearAllModuleButton entity="vehicles" />}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <div
            key={kpi.key}
            role="button"
            tabIndex={0}
            onClick={() => applyKpi(kpi.key)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              applyKpi(kpi.key);
            }}
            className="min-w-0 cursor-pointer"
          >
            <MetricTile
              label={kpi.label}
              value={kpi.value}
              icon={kpi.icon}
              tone={kpi.tone}
              selected={vehicleKpiSelected(kpi.key, filterState)}
              className="h-full p-2.5"
            />
          </div>
        ))}
      </div>

      <AppListCard
        toolbar={
          <AppListControls
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={t("searchPlaceholder")}
            searchAriaLabel={t("searchPlaceholder")}
            clearSearchLabel={labels.clearSearch}
            groupByOptions={[labels.group.none, labels.group.status, labels.group.project]}
            groupBy={prefs.groupBy}
            onGroupByChange={(value) => updateListPrefs({ groupBy: value })}
            groupByLabel={labels.groupBy}
            viewMode={prefs.viewMode}
            onViewModeChange={(value) => updateListPrefs({ viewMode: value })}
            tableViewLabel={labels.viewTable}
            cardsViewLabel={labels.viewCards}
            filterSlot={
              <>
                <Select
                  items={tabSelectItems}
                  value={activeTab}
                  onValueChange={(value) => {
                    if (value) replaceQuery({ tab: parseVehicleListTab(value) });
                  }}
                >
                  <SelectTrigger className="h-9 w-[148px] shrink-0 cursor-pointer rounded-lg text-xs">
                    <SelectValue placeholder={t("filterView")} />
                  </SelectTrigger>
                  <SelectContent>
                    {tabSelectItems.map((item) => (
                      <SelectItem key={item.value} value={item.value} className="cursor-pointer">
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {activeFilterCount > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 shrink-0 cursor-pointer gap-1.5 rounded-lg px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={clearAll}
                  >
                    <FilterX className="h-3.5 w-3.5" aria-hidden />
                    {t("clearAllFilters")}
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-semibold text-white tabular-nums">
                      {activeFilterCount}
                    </span>
                  </Button>
                ) : null}
                <AppTableColumnPicker
                  options={pickerOptions}
                  isVisible={isVisible}
                  onToggle={toggle}
                  onReset={reset}
                  hiddenCount={hiddenToggleableCount}
                />
              </>
            }
            trailing={
            <div className="flex shrink-0 items-center gap-1.5">
              {!isLoading ? (
                <p className="hidden text-xs tabular-nums text-muted-foreground lg:inline">
                  {t("showingCount", { shown: visible.length, total: vehicles.length })}
                </p>
              ) : null}
              <div className="hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 cursor-pointer rounded-lg"
                      onClick={() => {
                        void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
                        void refetch();
                      }}
                      disabled={isRefreshing}
                      aria-label={t("refresh")}
                    >
                      <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                    </Button>
                  }
                />
                <TooltipContent>{t("refresh")}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 cursor-pointer rounded-lg sm:w-auto sm:px-2.5"
                      onClick={() => downloadVehicleListXlsx(visible)}
                      disabled={isLoading || visible.length === 0}
                      aria-label={t("export")}
                    >
                      <Download className="h-4 w-4" />
                      <span className="ms-1.5 hidden md:inline">{t("export")}</span>
                    </Button>
                  }
                />
                <TooltipContent>{t("export")}</TooltipContent>
              </Tooltip>
              {canManage ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 cursor-pointer rounded-lg sm:w-auto sm:px-2.5"
                        onClick={() => setImportOpen(true)}
                        aria-label={t("bulkImport")}
                      >
                        <Upload className="h-4 w-4" />
                        <span className="ms-1.5 hidden md:inline">{t("bulkImport")}</span>
                      </Button>
                    }
                  />
                  <TooltipContent>{t("bulkImport")}</TooltipContent>
                </Tooltip>
              ) : null}
              {canCreate ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-9 shrink-0 cursor-pointer rounded-lg px-2.5"
                  onClick={() => replaceQuery({ add: true })}
                >
                  <Plus className="h-4 w-4" />
                  <span className="ms-1.5 hidden sm:inline">{t("addVehicle")}</span>
                </Button>
              ) : null}
            </div>
            }
          />
        }
      >
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : vehicles.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p>
            {canCreate ? (
              <Button
                type="button"
                size="sm"
                className="mt-4 cursor-pointer rounded-lg"
                onClick={() => replaceQuery({ add: true })}
              >
                <Plus className="me-2 h-3.5 w-3.5" />
                {t("addVehicle")}
              </Button>
            ) : null}
          </div>
        ) : (
          prefs.viewMode === "cards" ? (
          <CardContent className="p-4">
            {canManage && selectedRows.length > 0 ? (
              <VehicleBulkBar rows={selectedRows} onDone={() => setSelectedIds(new Set())} />
            ) : null}
            <GroupedSections groups={groupedVehicles} paged resetKey={vehicleResetKey}>
              {(rows) => (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => router.push(`/vehicles/${row.id}`)}
                      className="cursor-pointer rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/30"
                    >
                      <p className="truncate text-sm font-semibold text-foreground">{row.reg_number}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {row.assigned_driver_name || "—"}
                      </p>
                      <div className="mt-2">
                        <VehicleStatusBadge status={row.status} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </GroupedSections>
          </CardContent>
        ) : (
          <CardContent className="p-0">
            {canManage && selectedRows.length > 0 ? (
              <VehicleBulkBar rows={selectedRows} onDone={() => setSelectedIds(new Set())} />
            ) : null}
            <FlatListPager pager={listView.flatPager} onStep={listView.stepFlat} />
            <AppDataTable
              columns={tableColumns}
              stickyHeader
              headerRowClassName="bg-primary/5 hover:bg-primary/5"
              empty={
                visible.length === 0 ? (
                  <AppDataTableEmpty>
                    <AppEmptyState title={t("emptyFilters")} />
                  </AppDataTableEmpty>
                ) : undefined
              }
            >
              {listView.sections.flatMap((section) => [
                section.showHeader ? (
                  <GroupTableHeaderRow
                    key={`group-${section.key}`}
                    colSpan={tableColumns.length}
                    label={section.label}
                    total={section.total}
                    open={section.open}
                    page={section.page}
                    showPager={section.showPager}
                    onToggle={() => listView.toggle(section.key)}
                    onStep={(dir) => listView.step(section.key, dir)}
                  />
                ) : null,
                ...section.visibleRows.map((row) => (
                <VehicleRow
                  key={row.id}
                  row={row}
                  isVisible={isVisible}
                  showSelect={canManage}
                  selected={selectedIds.has(row.id)}
                  onToggle={() =>
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                  onOpen={() => router.push(`/vehicles/${row.id}`)}
                />
                )),
              ])}
            </AppDataTable>
          </CardContent>
        )
        )}
      </AppListCard>
      <VehicleFormDialog
        open={addOpen && canCreate}
        vehicle={null}
        types={types}
        vehicles={vehicles}
        onOpenChange={(open) => {
          if (!open && addOpen) replaceQuery({ add: false });
        }}
        onSaved={(id) => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
          if (addOpen) replaceQuery({ add: false });
          router.push(`/vehicles/${id}`);
        }}
      />
      <VehicleBulkImportDialog
        open={importOpen && canManage}
        vehicles={vehicles}
        onOpenChange={setImportOpen}
      />
    </AppPage>
  );
}

function VehicleRow({
  row,
  isVisible,
  showSelect,
  selected,
  onToggle,
  onOpen,
}: {
  row: VehicleListRow;
  isVisible: (id: string) => boolean;
  showSelect: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const t = useTranslations("pages.vehicles");
  return (
    <AppDataTableRow className="cursor-pointer" onClick={onOpen}>
      {showSelect ? (
        <TableCell className="w-10" onClick={(event) => event.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={() => onToggle()} aria-label={row.reg_number || row.bike_id} />
        </TableCell>
      ) : null}
      <VisibleTableCell columnId="plate" isVisible={isVisible} className="whitespace-nowrap">
        <p className="font-medium">{row.reg_number || row.bike_id}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <VehicleStatusBadge status={row.status} />
          {row.assigned_on_duty ? (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500 bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-900"
              title={row.assigned_shift_label ? t("shiftPlan", { range: row.assigned_shift_label }) : undefined}
            >
              <CircleDot className="size-2.5" />
              {t("tabOnDuty")}
            </span>
          ) : null}
        </div>
        <Link
          href={`/vehicles/${row.id}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:bg-primary/10"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
          {t("viewDetails")}
        </Link>
      </VisibleTableCell>
      <VisibleTableCell columnId="chassis" isVisible={isVisible} className="font-mono text-xs text-muted-foreground whitespace-nowrap">
        {row.chassis_no ?? "—"}
      </VisibleTableCell>
      <VisibleTableCell columnId="kind" isVisible={isVisible}>
        <KindBadge value={row.vehicle_type_key} />
      </VisibleTableCell>
      <VisibleTableCell columnId="model" isVisible={isVisible} className="whitespace-nowrap">
        {row.model ?? "—"}
      </VisibleTableCell>
      <VisibleTableCell columnId="year" isVisible={isVisible}>
        {row.model_year ?? "—"}
      </VisibleTableCell>
      <VisibleTableCell columnId="condition" isVisible={isVisible}>
        <ConditionBadge value={row.condition} />
      </VisibleTableCell>
      <VisibleTableCell columnId="chip" isVisible={isVisible} className="font-mono text-xs">
        {row.chip_no ?? "—"}
      </VisibleTableCell>
      <VisibleTableCell columnId="fuelType" isVisible={isVisible}>
        <FuelTypeBadge value={row.fuel_type} />
      </VisibleTableCell>
      <VisibleTableCell columnId="fuelCompany" isVisible={isVisible}>
        <FuelCompanyBadge value={row.fuel_company} />
      </VisibleTableCell>
      <VisibleTableCell columnId="carsCompany" isVisible={isVisible} className="whitespace-nowrap">
        {row.owner_partner_name ?? "—"}
      </VisibleTableCell>
      <VisibleTableCell columnId="project" isVisible={isVisible}>
        <ProjectBadge value={row.assigned_project_key} />
      </VisibleTableCell>
      <VisibleTableCell columnId="typeOfUse" isVisible={isVisible} className="whitespace-nowrap">
        {row.type_of_use
          ? isVehicleTypeOfUse(row.type_of_use)
            ? t(`typeOfUse.${row.type_of_use}`)
            : row.type_of_use_label || row.type_of_use
          : "—"}
      </VisibleTableCell>
      <VisibleTableCell columnId="company" isVisible={isVisible} className="whitespace-nowrap">
        {row.company_name ?? "—"}
      </VisibleTableCell>
      <VisibleTableCell columnId="location" isVisible={isVisible} className="whitespace-nowrap">
        {row.location_text ?? "—"}
      </VisibleTableCell>
      <VisibleTableCell columnId="driver" isVisible={isVisible} className="whitespace-nowrap">
        {row.assigned_driver_name
          ? `${row.assigned_driver_name}${row.assigned_employee_id ? ` · ${row.assigned_employee_id}` : ""}`
          : "—"}
      </VisibleTableCell>
      <VisibleTableCell columnId="empCompany" isVisible={isVisible} className="whitespace-nowrap">
        {row.assigned_partner_name ?? "—"}
      </VisibleTableCell>
      <VisibleTableCell columnId="carType" isVisible={isVisible}>
        <CarTypeBadge value={row.car_type} />
      </VisibleTableCell>
      <VisibleTableCell columnId="replacement" isVisible={isVisible}>
        <ReplacementBadge active={Boolean(row.replaces_vehicle_id)} />
      </VisibleTableCell>
      <VisibleTableCell columnId="repPlate" isVisible={isVisible} className="whitespace-nowrap">
        {row.replaces_plate ?? "—"}
      </VisibleTableCell>
      <VisibleTableCell columnId="since" isVisible={isVisible} className="whitespace-nowrap">
        {formatReplacementSince(row.replacement_started_at) ?? "—"}
      </VisibleTableCell>
    </AppDataTableRow>
  );
}
