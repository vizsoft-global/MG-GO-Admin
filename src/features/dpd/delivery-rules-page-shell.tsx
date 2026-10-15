"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
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
import { useAuth } from "@/contexts/auth-context";
import { ClearAllModuleButton } from "@/features/settings/clear-all-module-button";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import { deleteDeliveryRule, isDpdErrorKey } from "./dpd-actions";
import { DpdStatusBadge } from "./dpd-status-badge";
import { DeliveryRuleDpdImportDialog } from "./delivery-rule-dpd-import-dialog";
import { RuleFormSheet } from "./rule-form-sheet";
import type { DeliveryRuleRow } from "./types";
import { useDeliveryRules, useDpdScopeOptions } from "./use-dpd";

export function DeliveryRulesPageShell() {
  const t = useTranslations("pages.dpd");
  const tPage = useTranslations("pages.deliveryRules");
  const labels = useListControlLabels();
  const { prefs, update } = useListViewPrefs("delivery-rules");
  const { can } = useAuth();
  const canManage = can("earnings.manage");
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();

  const { data: scopeOptions } = useDpdScopeOptions();
  const { data: deliveryRules, isLoading } = useDeliveryRules();

  const [sheet, setSheet] = useState<{ open: boolean; row: DeliveryRuleRow | null }>({
    open: false,
    row: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<DeliveryRuleRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredRules = useMemo(
    () =>
      (deliveryRules ?? []).filter((row) =>
        fieldSearchMatch(row, search, prefs.searchField, {
          name: (item) => item.name,
          status: (item) => item.status,
          scope_label: (item) => item.scope_label,
          scope_search: (item) => item.scope_search,
        }),
      ),
    [deliveryRules, prefs.searchField, search],
  );
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
  const tableColCount = canManage ? 8 : 7;

  const handleDelete = () => {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteDeliveryRule(deleteTarget.id);
      if (result.error) {
        toast.error(
          isDpdErrorKey(result.error) ? t(`errors.${result.error}`) : t("errors.delete_failed"),
        );
        throw new Error(result.error);
      }
      toast.success(t("deliveryRuleDeleted"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.dpd.deliveryRules() });
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
            <ClearAllModuleButton entity="delivery_rules" />
            {canManage ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 cursor-pointer rounded-lg"
                  onClick={() => setImportOpen(true)}
                >
                  <Upload className="h-4 w-4" />
                  {t("bulkDpd")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 cursor-pointer rounded-lg"
                  onClick={() => setSheet({ open: true, row: null })}
                >
                  <Plus className="h-4 w-4" />
                  {t("addDeliveryRule")}
                </Button>
              </div>
            ) : null}
          </div>
        }
      />
      <AppListCard
        toolbar={
          !isLoading && (deliveryRules?.length ?? 0) > 0 ? (
            <AppListControls
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder={tPage("searchPlaceholder")}
              clearSearchLabel={labels.clearSearch}
              searchFields={[labels.field.all, labels.field.name, labels.field.status]}
              searchField={prefs.searchField}
              onSearchFieldChange={(value) => update({ searchField: value })}
              searchFieldLabel={labels.searchBy}
              groupByOptions={[labels.group.none, labels.group.status]}
              groupBy={prefs.groupBy}
              onGroupByChange={(value) => update({ groupBy: value })}
              groupByLabel={labels.groupBy}
              viewMode={prefs.viewMode}
              onViewModeChange={(value) => update({ viewMode: value })}
              tableViewLabel={labels.viewTable}
              cardsViewLabel={labels.viewCards}
            />
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (deliveryRules?.length ?? 0) === 0 ? (
          <AppEmptyState title={t("emptyDeliveryRules")} />
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
                      onClick={() => {
                        if (canManage) setSheet({ open: true, row });
                      }}
                    >
                      <p className="text-sm font-semibold">{row.name}</p>
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
                <TableHead className={TABLE_HEAD_CLASS}>{t("colDates")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colDpdTarget")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colDpdPeriod")}</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>{t("colPriority")}</TableHead>
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
                <TableRow key={row.id} className="hover:bg-muted/40">
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.scope_label}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.start_date} → {row.end_date}
                  </TableCell>
                  <TableCell>
                    <DpdStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="tabular-nums">{row.dpd_target ?? "—"}</TableCell>
                  <TableCell>{row.dpd_period ?? "—"}</TableCell>
                  <TableCell>{row.priority}</TableCell>
                  {canManage ? (
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="cursor-pointer"
                          onClick={() => setSheet({ open: true, row })}
                          aria-label={t("editDeliveryRule")}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setDeleteTarget(row)}
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

      <DeliveryRuleDpdImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onApplied={() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.dpd.deliveryRules() });
        }}
      />
      <RuleFormSheet
        rule={sheet.row}
        options={scopeOptions}
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
      />

      {deleteTarget ? (
        <ConfirmDeleteDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          itemTitle={t("deleteDeliveryRuleTitle")}
          itemName={deleteTarget.name}
          confirmText={deleteTarget.name}
          onConfirm={handleDelete}
          isPending={isPending}
        />
      ) : null}
    </AppPage>
  );
}
