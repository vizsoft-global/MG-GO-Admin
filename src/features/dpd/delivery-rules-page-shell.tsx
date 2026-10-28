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

type DeliveryRuleColumnId =
  | "name"
  | "scope"
  | "dates"
  | "status"
  | "dpdTarget"
  | "dpdPeriod"
  | "priority"
  | "edit";

function isDeliveryRuleColumnId(id: string): id is DeliveryRuleColumnId {
  switch (id) {
    case "name":
    case "scope":
    case "dates":
    case "status":
    case "dpdTarget":
    case "dpdPeriod":
    case "priority":
    case "edit":
      return true;
    default:
      return false;
  }
}

export function DeliveryRulesPageShell() {
  const t = useTranslations("pages.dpd");
  const tPage = useTranslations("pages.deliveryRules");
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

  const columns = useMemo((): TableToolbarColumn[] => {
    const cols: TableToolbarColumn[] = [
      { id: "name", label: t("colName"), locked: true },
      { id: "scope", label: t("colScope") },
      { id: "dates", label: t("colDates") },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "dpdTarget", label: t("colDpdTarget") },
      { id: "dpdPeriod", label: t("colDpdPeriod") },
      { id: "priority", label: t("colPriority") },
    ];
    if (canManage) cols.push({ id: "edit", label: t("edit") });
    return cols;
  }, [canManage, t]);
  const prefs = useTablePrefs("delivery-rules", columns);
  const visibleColumns = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

  const filteredRules = useMemo(
    () =>
      (deliveryRules ?? []).filter((row) =>
        fieldSearchMatch(row, prefs.appliedQuery, {
          name: (item) => item.name,
          status: (item) => item.status,
          scope_label: (item) => item.scope_label,
          scope_search: (item) => item.scope_search,
        }),
      ),
    [deliveryRules, prefs.appliedQuery],
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
  const listView = useGroupedListView(
    grouped,
    prefs.groupBy !== "none",
    `${prefs.groupBy}\u0001${prefs.appliedQuery}`,
  );

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

  const renderCell = (id: DeliveryRuleColumnId, row: DeliveryRuleRow) => {
    switch (id) {
      case "name":
        return <TableNameCell name={row.name} />;
      case "scope":
        return row.scope_label;
      case "dates":
        return `${row.start_date} → ${row.end_date}`;
      case "status":
        return <DpdStatusBadge status={row.status} />;
      case "dpdTarget":
        return row.dpd_target ?? "—";
      case "dpdPeriod":
        return row.dpd_period ?? "—";
      case "priority":
        return row.priority;
      case "edit":
        return (
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
        );
      default: {
        const _exhaustive: never = id;
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
            <ClearAllModuleButton entity="delivery_rules" />
            {canManage ? (
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
            ) : null}
          </div>
        }
      />
      <AppListCard
        toolbar={
          <TableToolbar
            prefs={prefs}
            entity={tPage("title")}
            columns={columns}
            rowKind="dynamic"
            entityList
            filteredCount={filteredRules.length}
            totalCount={deliveryRules?.length ?? 0}
            onAdd={canManage ? () => setSheet({ open: true, row: null }) : undefined}
            addLabel={t("addDeliveryRule")}
          />
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
        ) : prefs.view === "grid" ? (
          <div className="p-4">
            <GroupedSections
              groups={grouped}
              paged
              resetKey={`${prefs.groupBy}\u0001${prefs.appliedQuery}`}
            >
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
                      <TableNameCell name={row.name} />
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
                {visibleColumns.map((column) => (
                  <TableHead
                    key={column.id}
                    className={cn(TABLE_HEAD_CLASS, column.id === "edit" && "w-24 text-end")}
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
                        colSpan={visibleColumns.length}
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
                <TableRow key={row.id} className="hover:bg-muted/40">
                  {visibleColumns.map((column) => {
                    if (!isDeliveryRuleColumnId(column.id)) return null;
                    return (
                      <TableCell
                        key={column.id}
                        className={cn(
                          column.id === "name" && "font-medium",
                          column.id === "dates" && "text-sm text-muted-foreground",
                          column.id === "dpdTarget" && "tabular-nums",
                          column.id === "edit" && "text-end",
                        )}
                      >
                        {renderCell(column.id, row)}
                      </TableCell>
                    );
                  })}
                </TableRow>
                )),
              ])}
            </TableBody>
          </Table>
          </>
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
