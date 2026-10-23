"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import {
  AppEmptyState,
  AppListCard,
  AppPage,
  AppPageHeader,
} from "@/components/app";
import {
  AppListControls,
  GroupedSections,
  fieldSearchMatch,
  groupRows,
  useListControlLabels,
  useListViewPrefs,
} from "@/components/app/app-list-controls";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
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

export function IncentiveRulesPageShell() {
  const t = useTranslations("pages.dpd");
  const tPage = useTranslations("pages.incentiveRules");
  const labels = useListControlLabels();
  const { prefs, update } = useListViewPrefs("incentive-rules");
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<IncentiveRuleStatusFilter>("all");
  const [periodFilter, setPeriodFilter] = useState<IncentiveRulePeriodFilter>("all");

  const filteredRules = useMemo(() => {
    const scoped = filterIncentiveRules(incentiveRules ?? [], {
      query: "",
      status: statusFilter,
      period: periodFilter,
    });
    return scoped.filter((row) =>
      fieldSearchMatch(row, search, {
        name: (item) => displayIncentiveRuleName(item.name),
        status: (item) => item.status,
        scope_label: (item) => item.scope_label,
        period: (item) => item.period,
      }),
    );
  }, [incentiveRules, periodFilter, search, statusFilter]);
  const grouped = useMemo(
    () =>
      groupRows(
        filteredRules,
        prefs.groupBy,
        { status: (row) => row.status },
        {},
        "—",
      ),
    [filteredRules, prefs.groupBy],
  );
  const tableColCount = canManage ? 7 : 6;

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

  return (
    <AppPage>
      <AppPageHeader
        title={tPage("title")}
        description={tPage("subtitle")}
        actions={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <ClearAllModuleButton entity="incentive_rules" />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 cursor-pointer rounded-lg"
                disabled={exporting || filteredRules.length === 0}
              onClick={async () => {
                if (!filteredRules.length) {
                  toast.error(t("incentiveExportEmpty"));
                  return;
                }
                setExporting(true);
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
              }}
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {t("incentiveExport")}
            </Button>
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
            {canManage ? (
              <Button
                type="button"
                size="sm"
                className="h-9 cursor-pointer rounded-lg"
                onClick={() => setSheet({ open: true, row: null })}
              >
                <Plus className="h-4 w-4" />
                {t("addIncentiveRule")}
              </Button>
            ) : null}
            </div>
          </div>
        }
      />
      <p className="text-sm text-muted-foreground">{t("stackingHint")}</p>

      <AppListCard
        toolbar={
          !isLoading && (incentiveRules?.length ?? 0) > 0 ? (
            <AppListControls
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder={tPage("searchPlaceholder")}
              clearSearchLabel={labels.clearSearch}
              groupByOptions={[labels.group.none, labels.group.status]}
              groupBy={prefs.groupBy}
              onGroupByChange={(value) => update({ groupBy: value })}
              groupByLabel={labels.groupBy}
              viewMode={prefs.viewMode}
              onViewModeChange={(value) => update({ viewMode: value })}
              tableViewLabel={labels.viewTable}
              cardsViewLabel={labels.viewCards}
              filterSlot={
                <>
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
                </>
              }
            />
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
        ) : prefs.viewMode === "cards" ? (
          <div className="p-4">
            <GroupedSections groups={grouped}>
              {(groupRowsList) => (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {groupRowsList.map((row) => (
                    <button
                      type="button"
                      key={row.id}
                      className="w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/40"
                      onClick={() => router.push(`/incentive-rules/${row.id}`)}
                    >
                      <p className="text-sm font-semibold">{displayIncentiveRuleName(row.name)}</p>
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
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colScope")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colPeriod")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colTarget")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colReward")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                {canManage ? (
                  <TableHead className={cn(TABLE_HEAD_CLASS, "w-24 text-end")}>
                    {t("edit")}
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.flatMap((group) => [
                ...(prefs.groupBy !== "none"
                  ? [
                      <TableRow key={`g-${group.key}`} className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={tableColCount} className="text-xs font-semibold">
                          {group.label} · {group.rows.length}
                        </TableCell>
                      </TableRow>,
                    ]
                  : []),
                ...group.rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => router.push(`/incentive-rules/${row.id}`)}
                >
                  <TableCell className="font-medium">
                    {displayIncentiveRuleName(row.name)}
                    <p className="text-xs font-normal text-primary">
                      {tPage("viewDetails")}
                    </p>
                  </TableCell>
                  <TableCell>{row.scope_label}</TableCell>
                  <TableCell>{t(`period.${row.period}`)}</TableCell>
                  <TableCell>
                    {formatIncentiveTargetSummary(row, (key, values) =>
                      t(key, values),
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums text-sm">
                    {formatIncentiveRewardSummary(row, (key, values) =>
                      t(key, values),
                    )}
                  </TableCell>
                  <TableCell>
                    <DpdStatusBadge status={row.status} />
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
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
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(row);
                          }}
                          aria-label={t("delete")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
                )),
              ])}
            </TableBody>
          </Table>
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
