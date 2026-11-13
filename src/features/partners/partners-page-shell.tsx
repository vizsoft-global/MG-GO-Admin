"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Filter, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  FlatListPager,
  GroupedSections,
  fieldSearchMatch,
  groupRows,
  scopeSelectionState,
  toggleScopeSelection,
  useGroupedListView,
} from "@/components/app/app-list-controls";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { AppEmptyState } from "@/components/app/app-empty-state";
import {
  ClearAllModuleButton,
  useCanClearAll,
} from "@/features/settings/clear-all-module-button";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/auth-context";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { PartnerFormSheet } from "./partner-form-sheet";
import { useEntityCustomFields } from "@/features/custom-fields/use-entity-custom-fields";
import { usePartnersList } from "./use-partners";
import type { PartnerRow } from "./types";

type DriversFilter = "all" | "withDrivers" | "noDrivers";
type LogoFilter = "all" | "withLogo" | "noLogo";

function exportPartnersCsv(rows: PartnerRow[]) {
  const header = [
    "id",
    "name",
    "slug",
    "description",
    "driver_count",
    "has_logo",
    "created_at",
  ];
  const escape = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    header.join(","),
    ...rows.map((p) =>
      [
        p.id,
        p.name,
        p.slug,
        p.description,
        p.driver_count,
        p.logo_url ? "true" : "false",
        p.created_at,
      ]
        .map(escape)
        .join(","),
    ),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `partners-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatCreatedAt(iso: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function PartnersPageContent() {
  const locale = useLocale();
  const t = useTranslations("pages.partners");
  const tc = useTranslations("common");
  const { can } = useAuth();
  const canManage = can("partners.manage");
  const queryClient = useQueryClient();

  const { data: partners = [], isLoading, refetch } = usePartnersList();
  /**
   * Custom columns + slicers for this table.
   *
   * A definition added in Settings becomes a column here, a filter chip below and
   * an Excel column — no code change on this page. `select` / `checkbox` / `date`
   * fields also get a slicer, which is the client's "add a column and a slicer" in
   * one step.
   */
  const customFields = useEntityCustomFields("partner");
  const customFieldFilters = useState<Record<string, unknown>>({});
  const [customFilters, setCustomFilters] = customFieldFilters;
  const toolbarColumns = useMemo((): TableToolbarColumn[] => {
    const cols: TableToolbarColumn[] = [
      { id: "logo", label: t("colLogo") },
      { id: "partner", label: t("colPartner"), locked: true },
      { id: "description", label: t("colDescription") },
      { id: "drivers", label: t("colDrivers") },
      { id: "created", label: t("colCreated") },
      ...customFields.columns.map((column) => ({ id: column.id, label: column.label })),
    ];
    if (canManage) cols.push({ id: "actions", label: t("colActions") });
    return cols;
  }, [canManage, t, customFields.columns]);
  const tablePrefs = useTablePrefs("partners", toolbarColumns);
  const [driversFilter, setDriversFilter] = useState<DriversFilter>("all");
  const [logoFilter, setLogoFilter] = useState<LogoFilter>("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<PartnerRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const hasActiveFilters =
    driversFilter !== "all" ||
    logoFilter !== "all" ||
    customFields.filters.some((filter) => {
      const query = customFilters[filter.id];
      if (filter.kind === "list") return Array.isArray(query) && query.length > 0;
      return typeof query === "string" && query.trim() !== "";
    });

  const customFilterKey = JSON.stringify(customFilters);

  const visible = useMemo(() => {
    return partners.filter((p) => {
      if (
        !fieldSearchMatch(p, tablePrefs.appliedQuery, {
          name: (row) => row.name,
          slug: (row) => row.slug,
          description: (row) => row.description,
        })
      ) {
        return false;
      }
      if (driversFilter === "withDrivers" && p.driver_count === 0) return false;
      if (driversFilter === "noDrivers" && p.driver_count > 0) return false;
      if (logoFilter === "withLogo" && !p.logo_url) return false;
      if (logoFilter === "noLogo" && p.logo_url) return false;
      // Custom slicers, applied from the same rows the columns print from.
      for (const filter of customFields.filters) {
        if (
          !customFields.matches(
            p as unknown as { custom_fields?: unknown },
            filter,
            customFilters[filter.id],
          )
        ) {
          return false;
        }
      }
      return true;
    });
    // `customFilterKey` stands in for the record, so a filter change re-runs this
    // without the object identity forcing it on every render.
  }, [partners, tablePrefs.appliedQuery, driversFilter, logoFilter, customFields, customFilterKey]);
  const grouped = useMemo(
    () => groupRows(visible, "none", {}, {}, "—"),
    [visible],
  );
  const listView = useGroupedListView(
    grouped,
    false,
    `${tablePrefs.appliedQuery}\u0001${driversFilter}\u0001${logoFilter}`,
  );

  const canClear = useCanClearAll("partners");
  const scopeIds = useMemo(() => visible.map((partner) => partner.id), [visible]);
  const headerSelection = scopeSelectionState(selectedIds, scopeIds);

  const invalidatePartners = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.partners.all() });
  }, [queryClient]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAdd = () => {
    setEditingPartner(null);
    setSheetOpen(true);
  };

  const handleEdit = (partner: PartnerRow) => {
    setEditingPartner(partner);
    setSheetOpen(true);
  };

  const clearAllFilters = () => {
    setDriversFilter("all");
    setLogoFilter("all");
    setCustomFilters({});
  };

  const driversFilterLabel = (value: DriversFilter) => {
    switch (value) {
      case "withDrivers":
        return t("filterWithDrivers");
      case "noDrivers":
        return t("filterNoDrivers");
      default:
        return t("filterDriversAll");
    }
  };

  const logoFilterLabel = (value: LogoFilter) => {
    switch (value) {
      case "withLogo":
        return t("filterWithLogo");
      case "noLogo":
        return t("filterNoLogo");
      default:
        return t("filterLogoAll");
    }
  };

  const showEmptySearch =
    !isLoading && partners.length > 0 && visible.length === 0;
  const showEmptyAll = !isLoading && partners.length === 0;

  const tableColumns = useMemo(() => {
    const head = tablePrefs.orderedColumns
      .filter((column) => tablePrefs.isVisible(column.id))
      .map((column) => ({
        id: column.id,
        label: column.label,
        className: column.id === "logo" ? "w-14" : column.id === "actions" ? "w-12 text-end" : undefined,
      }));
    if (!canClear) return head;
    return [
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
            aria-label={tc("selectAll")}
          />
        ),
      },
      ...head,
    ];
  }, [canClear, headerSelection, scopeIds, tablePrefs, tc]);

  const filterChips = [
    ...(driversFilter !== "all"
      ? [{ id: "drivers", label: `${t("filterDrivers")}: ${driversFilterLabel(driversFilter)}` }]
      : []),
    ...(logoFilter !== "all"
      ? [{ id: "logo", label: `${t("filterLogo")}: ${logoFilterLabel(logoFilter)}` }]
      : []),
    // A custom slicer that is narrowing the list says so, beside the built-in ones.
    ...customFields.filters.flatMap((filter) => {
      const query = customFilters[filter.id];
      if (filter.kind === "list") {
        if (!Array.isArray(query) || query.length === 0) return [];
        const label = query
          .map((value) => filter.labels[String(value)] ?? String(value))
          .join(", ");
        return [{ id: filter.id, label: `${filter.label}: ${label}` }];
      }
      if (typeof query !== "string" || !query.trim()) return [];
      return [{ id: filter.id, label: `${filter.label}: ${query}` }];
    }),
  ];

  const toolbar = (
    <TableToolbar
      prefs={tablePrefs}
      entity={t("title")}
      columns={toolbarColumns}
      rowKind="dynamic"
      entityList
      filteredCount={visible.length}
      totalCount={partners.length}
      onExport={() => exportPartnersCsv(visible)}
      onAdd={canManage ? handleAdd : undefined}
      addLabel={t("addPartner")}
      chips={filterChips}
      onRemoveChip={(id) => {
        if (id === "drivers") setDriversFilter("all");
        if (id === "logo") setLogoFilter("all");
      }}
      onClearChips={clearAllFilters}
    />
  );

  const filterMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "h-9 shrink-0 cursor-pointer rounded-lg",
        )}
      >
        <Filter className="me-2 h-3.5 w-3.5" />
        {t("filter")}
        {hasActiveFilters ? (
          <Badge
            variant="secondary"
            className="ms-2 h-5 min-w-5 rounded-full px-1.5 text-xs"
          >
            {(driversFilter !== "all" ? 1 : 0) + (logoFilter !== "all" ? 1 : 0)}
          </Badge>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("filterDrivers")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={driversFilter}
            onValueChange={(v) => setDriversFilter((v as DriversFilter) ?? "all")}
          >
            <DropdownMenuRadioItem value="all">
              {t("filterDriversAll")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="withDrivers">
              {t("filterWithDrivers")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="noDrivers">
              {t("filterNoDrivers")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("filterLogo")}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={logoFilter}
            onValueChange={(v) => setLogoFilter((v as LogoFilter) ?? "all")}
          >
            <DropdownMenuRadioItem value="all">
              {t("filterLogoAll")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="withLogo">
              {t("filterWithLogo")}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="noLogo">
              {t("filterNoLogo")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {/* Custom slicers: one group per definition, drawn from the same store
            that renders the column. Nothing here is hard-coded per page. */}
        {customFields.filters.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            {customFields.filters.map((filter) => {
              if (filter.kind === "list") {
                const selected = Array.isArray(customFilters[filter.id])
                  ? (customFilters[filter.id] as unknown[]).map(String)
                  : [];
                return (
                  <DropdownMenuGroup key={filter.id}>
                    <DropdownMenuLabel>{filter.label}</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem
                      checked={selected.length === 0}
                      onCheckedChange={() =>
                        setCustomFilters((current) => ({ ...current, [filter.id]: [] }))
                      }
                    >
                      {t("filterAllValues")}
                    </DropdownMenuCheckboxItem>
                    {filter.values.map((value) => (
                      <DropdownMenuCheckboxItem
                        key={value}
                        checked={selected.includes(value)}
                        onCheckedChange={(next: boolean) => {
                          const base = selected.filter((item) => item !== value);
                          const updated = next ? [...base, value] : base;
                          setCustomFilters((current) => ({ ...current, [filter.id]: updated }));
                        }}
                      >
                        {filter.labels[value] ?? value}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                );
              }
              return (
                <DropdownMenuGroup key={filter.id}>
                  <DropdownMenuLabel>{filter.label}</DropdownMenuLabel>
                  <div className="px-2 pb-2">
                    <Input
                      className="h-8"
                      type={filter.kind === "date" ? "date" : "text"}
                      value={
                        typeof customFilters[filter.id] === "string"
                          ? (customFilters[filter.id] as string)
                          : ""
                      }
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setCustomFilters((current) => ({
                          ...current,
                          [filter.id]: event.target.value,
                        }))
                      }
                    />
                  </div>
                </DropdownMenuGroup>
              );
            })}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <ClearAllModuleButton
                entity="partners"
                selectedIds={selectedIds}
                onSuccess={() => {
                  setSelectedIds(new Set());
                  invalidatePartners();
                  void refetch();
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 cursor-pointer rounded-lg"
                onClick={handleRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={`me-2 h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                />
                {t("refresh")}
              </Button>
              {filterMenu}
            </div>
        }
      />
      <AppListCard>
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : showEmptyAll ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("emptyDescription")}</p>
            {canManage ? (
              <Button
                type="button"
                size="sm"
                className="mt-4 cursor-pointer rounded-lg"
                onClick={handleAdd}
              >
                <Plus className="me-2 h-3.5 w-3.5" />
                {t("addPartner")}
              </Button>
            ) : null}
          </div>
        ) : tablePrefs.view === "grid" ? (
          <CardContent className="p-0">
            {toolbar}
            {showEmptySearch ? (
              <AppEmptyState
                title={t("emptySearchTitle")}
                description={t("emptySearchDescription")}
              />
            ) : (
              <GroupedSections groups={grouped} paged resetKey={`${tablePrefs.appliedQuery}\u0001${driversFilter}\u0001${logoFilter}`}>
                {(rows) => (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {rows.map((partner) => (
                      <button
                        type="button"
                        key={partner.id}
                        className="w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/40"
                        onClick={() => canManage && handleEdit(partner)}
                      >
                        <p className="truncate text-sm font-semibold">{partner.name}</p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {partner.slug}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t("driversCount", { count: partner.driver_count })}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </GroupedSections>
            )}
          </CardContent>
        ) : (
          <CardContent className="p-0">
            <FlatListPager pager={listView.flatPager} onStep={listView.stepFlat} />
            <AppDataTable
              toolbar={toolbar}
              columns={tableColumns}
              empty={
                showEmptySearch ? (
                  <AppDataTableEmpty>
                    <AppEmptyState
                      title={t("emptySearchTitle")}
                      description={t("emptySearchDescription")}
                    />
                  </AppDataTableEmpty>
                ) : undefined
              }
            >
              {!showEmptySearch
                ? listView.sections.flatMap((section) =>
                    section.visibleRows.map((partner) => (
                    <AppDataTableRow
                      key={partner.id}
                      role={canManage ? "button" : undefined}
                      tabIndex={canManage ? 0 : undefined}
                      className={cn(canManage && "cursor-pointer")}
                      onClick={() => canManage && handleEdit(partner)}
                      onKeyDown={(e) => {
                        if (
                          canManage &&
                          (e.key === "Enter" || e.key === " ")
                        ) {
                          e.preventDefault();
                          handleEdit(partner);
                        }
                      }}
                    >
                      {canClear ? (
                        <TableCell
                          className="w-10"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedIds.has(partner.id)}
                            onCheckedChange={() => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(partner.id)) next.delete(partner.id);
                                else next.add(partner.id);
                                return next;
                              });
                            }}
                            aria-label={partner.name}
                          />
                        </TableCell>
                      ) : null}
                      {tableColumns.map((column) => {
                        switch (column.id) {
                          case "logo":
                            return (
                              <TableCell key={column.id}>
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30">
                                  {partner.logo_url ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={partner.logo_url}
                                      alt=""
                                      className="h-full w-full object-contain p-0.5"
                                    />
                                  ) : (
                                    <span className="text-sm font-semibold text-muted-foreground">
                                      {partner.name.charAt(0).toUpperCase()}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                            );
                          case "partner":
                            return (
                              <TableCell key={column.id}>
                                <div className="min-w-0">
                                  <TableNameCell name={partner.name} />
                                  <p className="font-mono text-xs text-muted-foreground">
                                    {partner.slug}
                                  </p>
                                </div>
                              </TableCell>
                            );
                          case "description":
                            return (
                              <TableCell key={column.id} className="max-w-xs">
                                {partner.description ? (
                                  <p className="line-clamp-2 text-sm text-muted-foreground">
                                    {partner.description}
                                  </p>
                                ) : (
                                  <EmptyCell />
                                )}
                              </TableCell>
                            );
                          case "drivers":
                            return (
                              <TableCell key={column.id} className="text-sm text-muted-foreground">
                                {t("driversCount", { count: partner.driver_count })}
                              </TableCell>
                            );
                          case "created":
                            return (
                              <TableCell key={column.id} className="text-sm text-muted-foreground">
                                {formatCreatedAt(partner.created_at, locale)}
                              </TableCell>
                            );
                          case "actions":
                            return (
                              <TableCell key={column.id} className="text-end">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="shrink-0 cursor-pointer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEdit(partner);
                                  }}
                                  aria-label={t("editPartner")}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            );
                          default: {
                            // A `cf:<key>` column: the value the operator saved on
                            // this partner, printed through its definition.
                            const custom = customFields.columns.find((item) => item.id === column.id);
                            if (!custom) return null;
                            const text = customFields.display(
                              partner as unknown as { custom_fields?: unknown },
                              custom.key,
                            );
                            return (
                              <TableCell key={column.id} className="text-sm text-muted-foreground">
                                {text || "—"}
                              </TableCell>
                            );
                          }
                        }
                      })}
                    </AppDataTableRow>
                  )))
                : null}
            </AppDataTable>
          </CardContent>
        )}
      </AppListCard>

      <PartnerFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        partner={editingPartner}
        onSaved={invalidatePartners}
        onDeleted={invalidatePartners}
      />
    </AppPage>
  );
}

export function PartnersPageShell() {
  return (
    <PartnersPageContent />
  );
}
