"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CalendarClock,
  Layers,
  Loader2,
  Scale,
  ShieldAlert,
  Users,
} from "lucide-react";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  GroupedSections,
  fieldSearchMatch,
  groupRows,
  scopeSelectionState,
  toggleScopeSelection,
} from "@/components/app/app-list-controls";
import { Checkbox } from "@/components/ui/checkbox";
import {
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { useRouter } from "@/i18n/navigation";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { AppEmptyState } from "@/components/app/app-empty-state";
import { Badge } from "@/components/ui/badge";
import { KpiGrid, type KpiGridItem } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { useAuth } from "@/contexts/auth-context";
import { WrongActionFormDialog } from "./wrong-action-form-dialog";
import {
  ClearAllModuleButton,
  useCanClearAll,
} from "@/features/settings/clear-all-module-button";
import { useWrongActionDriverOptions, useWrongActionsList } from "./use-wrong-actions";
import type { WrongActionRow, WrongActionSeverity } from "./types";
import {
  parseWrongActionTab,
  wrongActionKpis,
  wrongActionMatchesTab,
  type WrongActionTab,
} from "./wrong-actions-list-utils";

export function severityTone(
  severity: WrongActionSeverity,
): "default" | "secondary" | "destructive" {
  if (severity === "high") return "destructive";
  if (severity === "medium") return "secondary";
  return "default";
}

export function formatKuwait(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuwait",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function WrongActionsPageShell({
  addOpen,
  tab,
}: {
  addOpen: boolean;
  tab?: string;
}) {
  const t = useTranslations("pages.wrongActions");
  const toolbarColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "driver", label: t("colDriver"), locked: true },
      { id: "type", label: t("colType") },
      { id: "status", label: t("colSeverity"), categorical: true },
      { id: "zone", label: t("colZone"), categorical: true },
      { id: "date", label: t("colDate") },
      { id: "source", label: t("colSource"), categorical: true },
    ],
    [t],
  );
  const prefs = useTablePrefs("wrong-actions", toolbarColumns);
  const { can } = useAuth();
  const canManage = can("wrong_actions.manage");
  const canClear = useCanClearAll("wrong_actions");
  const canSelect = canManage || canClear;
  const router = useRouter();
  const { data: rows = [], isLoading, refetch } = useWrongActionsList();
  const { data: drivers = [], isLoading: driversLoading } = useWrongActionDriverOptions(
    addOpen && canManage,
  );
  const activeTab = parseWrongActionTab(tab);

  // One clock for the whole render, so the "this week" tab and the KPI counting
  // the same rows cannot disagree by a millisecond at a midnight boundary.
  const now = useMemo(() => new Date(), []);

  const replaceQuery = (next: { add?: boolean; tab?: WrongActionTab }) => {
    const params = new URLSearchParams();
    const nextTab = next.tab ?? activeTab;
    const nextAdd = next.add ?? addOpen;
    if (nextTab !== "all") params.set("tab", nextTab);
    if (nextAdd) params.set("add", "1");
    const qs = params.toString();
    router.replace(qs ? `/wrong-actions?${qs}` : "/wrong-actions");
  };

  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          wrongActionMatchesTab(row, activeTab, now) &&
          fieldSearchMatch(row, prefs.appliedQuery, {
            name: (item) => item.driver_name,
            employee_id: (item) => item.driver_code,
            zone: (item) => item.driver_zone_name,
            status: (item) => item.severity,
            type: (item) => item.action_type,
            details: (item) => item.details,
            createdBy: (item) => item.created_by_name,
          }),
      ),
    [activeTab, now, prefs.appliedQuery, rows],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const scopeIds = useMemo(() => visible.map((row) => row.id), [visible]);
  const headerSelection = scopeSelectionState(selectedIds, scopeIds);
  const grouped = useMemo(
    () =>
      groupRows(
        visible,
        prefs.groupBy,
        {
          status: (row) => row.severity,
          zone: (row) => row.driver_zone_name,
        },
        {
          high: t("severity.high"),
          medium: t("severity.medium"),
          low: t("severity.low"),
        },
        "—",
      ),
    [prefs.groupBy, t, visible],
  );

  const counts = useMemo(() => wrongActionKpis(rows, now), [now, rows]);
  const dash = (value: number) => (isLoading ? "—" : String(value));
  const selectTab = (next: WrongActionTab) =>
    replaceQuery({ tab: activeTab === next && next !== "all" ? "all" : next });
  const kpis: KpiGridItem[] = [
    {
      label: t("kpiTotal"),
      value: dash(counts.total),
      icon: Layers,
      accent: "primary",
      selected: activeTab === "all",
      onClick: () => replaceQuery({ tab: "all" }),
    },
    {
      label: t("kpiHigh"),
      value: dash(counts.high),
      icon: ShieldAlert,
      accent: "danger",
      selected: activeTab === "high",
      onClick: () => selectTab("high"),
    },
    {
      label: t("kpiMedium"),
      value: dash(counts.medium),
      icon: AlertTriangle,
      accent: "warning",
      selected: activeTab === "medium",
      onClick: () => selectTab("medium"),
    },
    {
      label: t("kpiLow"),
      value: dash(counts.low),
      icon: AlertTriangle,
      selected: activeTab === "low",
      onClick: () => selectTab("low"),
    },
    {
      label: t("kpiThisWeek"),
      value: dash(counts.thisWeek),
      icon: CalendarClock,
      selected: activeTab === "week",
      onClick: () => selectTab("week"),
    },
    { label: t("kpiWeighted"), value: dash(counts.weighted), icon: Scale },
    { label: t("kpiDrivers"), value: dash(counts.driversInvolved), icon: Users },
  ];

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ClearAllModuleButton
              entity="wrong_actions"
              selectedIds={selectedIds}
              onSuccess={() => {
                setSelectedIds(new Set());
                void refetch();
              }}
            />
          </div>
        }
        tabs={
          <TabBar
            activeId={activeTab}
            onSelect={(id) => replaceQuery({ tab: parseWrongActionTab(id) })}
            items={[
              { id: "all", label: t("tabAll"), icon: Layers },
              { id: "high", label: t("severity.high"), icon: ShieldAlert },
              { id: "medium", label: t("severity.medium"), icon: AlertTriangle },
              { id: "low", label: t("severity.low"), icon: AlertTriangle },
              { id: "week", label: t("tabWeek"), icon: CalendarClock },
            ]}
          />
        }
      />
      <KpiGrid items={kpis} compact />
      <AppListCard
        toolbar={
          <TableToolbar
            prefs={prefs}
            entity={t("title")}
            columns={toolbarColumns}
            rowKind="dynamic"
            entityList
            filteredCount={visible.length}
            totalCount={rows.length}
            onAdd={canManage ? () => replaceQuery({ add: true }) : undefined}
            addLabel={t("addIncident")}
          />
        }
      >
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        ) : prefs.view === "grid" ? (
          visible.length === 0 ? (
            <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty>
          ) : (
            <div className="p-4">
              <GroupedSections groups={grouped}>
                {(groupRowsList) => (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {groupRowsList.map((row) => (
                      <button
                        type="button"
                        key={row.id}
                        className="w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/40"
                        onClick={() => router.push(`/wrong-actions/${row.id}`)}
                      >
                        <p className="truncate text-sm font-semibold">{row.driver_name ?? "—"}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {t(`type.${row.action_type}` as "type.delay")}
                          {row.driver_code ? ` · ${row.driver_code}` : ""}
                        </p>
                        <div className="mt-2">
                          <Badge variant={severityTone(row.severity)}>
                            {t(`severity.${row.severity}` as "severity.low")}
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </GroupedSections>
            </div>
          )
        ) : (
          <AppDataTable
            columns={[
              ...(canSelect
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
                          aria-label={t("selectAll")}
                        />
                      ),
                    },
                  ]
                : []),
              { id: "driver", label: t("colDriver") },
              { id: "type", label: t("colType") },
              { id: "severity", label: t("colSeverity") },
              { id: "date", label: t("colDate") },
              { id: "source", label: t("colSource") },
            ]}
            empty={
              visible.length === 0 ? (
                <AppDataTableEmpty>{t("emptyFilters")}</AppDataTableEmpty>
              ) : null
            }
          >
            {grouped.flatMap((group) => [
              ...(prefs.groupBy !== "none"
                ? [
                    <AppDataTableRow key={`g-${group.key}`} className="hover:bg-transparent">
                      <TableCell
                        colSpan={canSelect ? 6 : 5}
                        className="bg-muted/40 py-2 text-xs font-semibold text-foreground"
                      >
                        {group.label}
                        <span className="ms-2 rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
                          {group.rows.length}
                        </span>
                      </TableCell>
                    </AppDataTableRow>,
                  ]
                : []),
              ...group.rows.map((row) => (
                <WrongActionListRow
                  key={row.id}
                  row={row}
                  selectable={canSelect}
                  selected={selectedIds.has(row.id)}
                  onToggle={() =>
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                  onOpen={() => router.push(`/wrong-actions/${row.id}`)}
                />
              )),
            ])}
          </AppDataTable>
        )}
      </AppListCard>
      <WrongActionFormDialog
        open={addOpen && canManage}
        incident={null}
        drivers={drivers}
        driversLoading={driversLoading}
        onOpenChange={(open) => {
          if (!open) replaceQuery({ add: false });
        }}
        onSaved={(id) => router.replace(`/wrong-actions/${id}`)}
      />
    </AppPage>
  );
}

function WrongActionListRow({
  row,
  selectable,
  selected,
  onToggle,
  onOpen,
}: {
  row: WrongActionRow;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const t = useTranslations("pages.wrongActions");
  return (
    <AppDataTableRow className="cursor-pointer" onClick={onOpen}>
      {selectable ? (
        <TableCell className="w-10" onClick={(event) => event.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={row.driver_name ?? undefined} />
        </TableCell>
      ) : null}
      <TableCell>
        <div className="flex items-center gap-2">
          <TableNameCell name={row.driver_name} />
          {row.driver_code ? (
            <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
              {row.driver_code}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-primary">{t("viewDetails")}</p>
      </TableCell>
      <TableCell>{t(`type.${row.action_type}` as "type.delay")}</TableCell>
      <TableCell>
        <Badge variant={severityTone(row.severity)}>
          {t(`severity.${row.severity}` as "severity.low")}
        </Badge>
      </TableCell>
      <TableCell>{formatKuwait(row.occurred_at)}</TableCell>
      <TableCell>{t(`source.${row.source}` as "source.admin")}</TableCell>
    </AppDataTableRow>
  );
}
