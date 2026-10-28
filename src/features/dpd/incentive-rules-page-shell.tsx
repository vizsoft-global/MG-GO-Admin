"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import {
  AppEmptyState,
  AppListCard,
  AppPage,
  AppPageHeader,
} from "@/components/app";
import {
  FlatListPager,
  GroupedSections,
  GroupTableHeaderRow,
  fieldSearchMatch,
  groupRows,
  useGroupedListView,
} from "@/components/app/app-list-controls";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/contexts/auth-context";
import { ClearAllModuleButton } from "@/features/settings/clear-all-module-button";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query/query-keys";
import { selectOptions } from "@/lib/select-items";
import { cn } from "@/lib/utils";
import { deleteIncentiveRule, isDpdErrorKey } from "./dpd-actions";
import { DpdStatusBadge } from "./dpd-status-badge";
import {
  displayIncentiveRuleName,
  filterIncentiveRules,
  isIncentiveRulePeriodFilter,
  isIncentiveRuleStatusFilter,
  type IncentiveRulePeriodFilter,
  type IncentiveRuleStatusFilter,
} from "./incentive-rule-filter";
import { IncentiveRuleFormSheet } from "./incentive-rule-form-sheet";
import { IncentiveRuleImportDialog } from "./incentive-rule-import-dialog";
import { buildIncentiveRulesWorkbook } from "./incentive-rule-xlsx";
import {
  formatIncentiveRewardSummary,
  formatIncentiveTargetSummary,
  INCENTIVE_PERIODS,
  RULE_STATUSES,
  type IncentiveRuleRow,
} from "./types";
import { useDpdScopeOptions, useIncentiveRules } from "./use-dpd";

const INCENTIVE_COLUMN_IDS = [
  "name",
  "scope",
  "period",
  "target",
  "reward",
  "status",
  "actions",
] as const;

type IncentiveColumnId = (typeof INCENTIVE_COLUMN_IDS)[number];

function isIncentiveColumnId(id: string): id is IncentiveColumnId {
  return (INCENTIVE_COLUMN_IDS as readonly string[]).includes(id);
}

export function IncentiveRulesPageShell() {
  const t = useTranslations("pages.dpd");
  const tPage = useTranslations("pages.incentiveRules");
  const { can } = useAuth();
  const canManage = can("earnings.manage");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();

  const { data: scopeOptions } = useDpdScopeOptions();
  const { data: incentiveRules, isLoading } = useIncentiveRules();

  const [sheet, setSheet] = useState<{ open: boolean; row: IncentiveRuleRow | null }>({
    open: false,
    row: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<IncentiveRuleRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<IncentiveRuleStatusFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<IncentiveRulePeriodFilter>("all");
  const columns = useMemo((): TableToolbarColumn[] => {
    const cols: TableToolbarColumn[] = [
      { id: "name", label: t("colName"), locked: true },
      { id: "scope", label: t("colScope") },
      { id: "period", label: t("colPeriod"), categorical: true },
      { id: "target", label: t("colTarget") },
      { id: "reward", label: t("colReward") },
      { id: "status", label: t("colStatus"), categorical: true },
    ];
    if (canManage) cols.push({ id: "actions", label: t("edit") });
    return cols;
  }, [canManage, t]);
  const prefs = useTablePrefs("incentive-rules", columns);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

  const filteredRules = useMemo(() => {
    const scoped = filterIncentiveRules(incentiveRules ?? [], {
      query: "",
      status: statusFilter,
      period: periodFilter,
    });
    return scoped.filter((row) =>
      fieldSearchMatch(row, prefs.appliedQuery, {
        name: (item) => displayIncentiveRuleName(item.name),
        status: (item) => item.status,
        scope_label: (item) => item.scope_label,
        period: (item) => item.period,
      }),
    );
  }, [incentiveRules, periodFilter, prefs.appliedQuery, statusFilter]);
  const grouped = useMemo(
    () =>
      groupRows(
        filteredRules,
        prefs.groupBy,
        {
          status: (row) => row.status,
          period: (row) => row.period,
        },
        {
          draft: t("status.draft"),
          active: t("status.active"),
          ended: t("status.ended"),
          daily: t("period.daily"),
          weekly: t("period.weekly"),
          monthly: t("period.monthly"),
        },
        "—",
      ),
    [filteredRules, prefs.groupBy, t],
  );
  const listResetKey = `${prefs.groupBy}\u0001${prefs.appliedQuery}\u0001${statusFilter}\u0001${periodFilter}`;
  const listView = useGroupedListView(grouped, prefs.groupBy !== "none", listResetKey);

  const statusItems = selectOptions([
    { value: "all", label: tPage("statusAll") },
    ...RULE_STATUSES.map((status) => ({ value: status, label: t(`status.${status}`) })),
  ]);
  const periodItems = selectOptions([
    { value: "all", label: tPage("periodAll") },
    ...INCENTIVE_PERIODS.map((period) => ({ value: period, label: t(`period.${period}`) })),
  ]);

  const handleDelete = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteIncentiveRule(deleteTarget.id);
      if (result.error) {
        toast.error(
          isDpdErrorKey(result.error) ? t(`errors.${result.error}`) : t("errors.delete_failed"),
        );
        throw new Error(result.error);
      }
      toast.success(t("incentiveRuleDeleted"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.dpd.incentiveRules() });
      setDeleteTarget(null);
    });
  };

  const exportRules = () => {
    if (exporting) return;
    if (!filteredRules.length) {
      toast.error(t("incentiveExportEmpty"));
      return;
    }
    setExporting(true);
    void (async () => {
      try {
        const buf = await buildIncentiveRulesWorkbook(filteredRules);
        const blob = new Blob([buf], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "incentive-rules.xlsx";
        a.click();
        URL.revokeObjectURL(url);
      } finally {
        setExporting(false);
      }
    })();
  };

  const ruleCell = (columnId: IncentiveColumnId, row: IncentiveRuleRow) => {
    switch (columnId) {
      case "name":
        return (
          <TableCell key={columnId} className="font-medium">
            <TableNameCell name={displayIncentiveRuleName(row.name)} />
            <p className="text-xs font-normal text-primary">{tPage("viewDetails")}</p>
          </TableCell>
        );
      case "scope":
        return <TableCell key={columnId}>{row.scope_label}</TableCell>;
      case "period":
        return <TableCell key={columnId}>{t(`period.${row.period}`)}</TableCell>;
      case "target":
        return (
          <TableCell key={columnId}>
            {formatIncentiveTargetSummary(row, (key, values) => t(key, values))}
          </TableCell>
        );
      case "reward":
        return (
          <TableCell key={columnId} className="tabular-nums text-sm">
            {formatIncentiveRewardSummary(row, (key, values) => t(key, values))}
          </TableCell>
        );
      case "status":
        return (
          <TableCell key={columnId}>
            <DpdStatusBadge status={row.status} />
          </TableCell>
        );
      case "actions":
        return (
          <TableCell key={columnId} className="text-end">
            <div className="flex items-center justify-end gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="cursor-pointer"
                onClick={(event) => {
                  event.stopPropagation();
                  setSheet({ open: true, row });
                }}
                aria-label={t("editIncentiveRule")}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  setDeleteTarget(row);
                }}
                aria-label={t("delete")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </TableCell>
        );
      default: {
        const _exhaustive: never = columnId;
        return _exhaustive;
      }
    }
  };

  return (
    <AppPage>
      <AppPageHeader
        title={tPage("title")}
        description={tPage("subtitle")}
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ClearAllModuleButton entity="incentive_rules" />
            {canManage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 cursor-pointer rounded-lg"
                onClick={() => setImportOpen(true)}
              >
                <Upload className="h-4 w-4" />
                {t("incentivePreview")}
              </Button>
            ) : null}
          </div>
        }
      />
      <p className="text-sm text-muted-foreground">{t("stackingHint")}</p>

      <AppListCard
        toolbar={
          !isLoading && (incentiveRules?.length ?? 0) > 0 ? (
            <div>
              <TableToolbar
                prefs={prefs}
                entity={tPage("title")}
                columns={columns}
                rowKind="dynamic"
                entityList
                filteredCount={filteredRules.length}
                totalCount={incentiveRules?.length ?? 0}
                onExport={exportRules}
                onAdd={canManage ? () => setSheet({ open: true, row: null }) : undefined}
                addLabel={t("addIncentiveRule")}
              />
              <div className="flex flex-wrap gap-2 px-4 pb-3">
                <Select
                  items={statusItems}
                  value={statusFilter}
                  onValueChange={(value) => {
                    if (value && isIncentiveRuleStatusFilter(value)) setStatusFilter(value);
                  }}
                >
                  <SelectTrigger className="h-9 w-[150px]" aria-label={tPage("filterStatus")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  items={periodItems}
                  value={periodFilter}
                  onValueChange={(value) => {
                    if (value && isIncentiveRulePeriodFilter(value)) setPeriodFilter(value);
                  }}
                >
                  <SelectTrigger className="h-9 w-[150px]" aria-label={tPage("filterPeriod")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {periodItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (incentiveRules?.length ?? 0) === 0 ? (
          <AppEmptyState title={t("emptyIncentiveRules")} />
        ) : filteredRules.length === 0 ? (
          <div className="p-4">
            <AppEmptyState title={tPage("emptyFiltered")} />
          </div>
        ) : prefs.view === "grid" ? (
          <div className="p-4">
            <GroupedSections groups={grouped} paged resetKey={listResetKey}>
              {(groupRowsList) => (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {groupRowsList.map((row) => (
                    <button
                      type="button"
                      key={row.id}
                      className="w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/40"
                      onClick={() => router.push(`/incentive-rules/${row.id}`)}
                    >
                      <TableNameCell name={displayIncentiveRuleName(row.name)} />
                      <p className="mt-1 text-xs text-muted-foreground">{row.scope_label}</p>
                      <div className="mt-2">
                        <DpdStatusBadge status={row.status} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </GroupedSections>
          </div>
        ) : (
          <>
          <FlatListPager pager={listView.flatPager} onStep={listView.stepFlat} />
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                {shown.map((column) => (
                  <TableHead
                    key={column.id}
                    className={cn(TABLE_HEAD_CLASS, column.id === "actions" && "w-24 text-end")}
                  >
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {listView.sections.flatMap((section) => [
                ...(section.showHeader
                  ? [
                      <GroupTableHeaderRow
                        key={`g-${section.key}`}
                        colSpan={shown.length}
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
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => router.push(`/incentive-rules/${row.id}`)}
                >
                  {shown.map((column) =>
                    isIncentiveColumnId(column.id) ? ruleCell(column.id, row) : null,
                  )}
                </TableRow>
                )),
              ])}
            </TableBody>
          </Table>
          </>
        )}
      </AppListCard>

      <IncentiveRuleImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onApplied={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.dpd.incentiveRules() });
        }}
      />

      <IncentiveRuleFormSheet
        rule={sheet.row}
        options={scopeOptions}
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
      />

      {deleteTarget ? (
        <ConfirmDeleteDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          itemTitle={t("deleteIncentiveRuleTitle")}
          itemName={deleteTarget.name}
          confirmText={deleteTarget.name}
          onConfirm={handleDelete}
          isPending={isPending}
        />
      ) : null}
    </AppPage>
  );
}
