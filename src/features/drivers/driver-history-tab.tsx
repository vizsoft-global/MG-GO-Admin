"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  ChevronDown,
  CircleDot,
  FileText,
  ListFilter,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Upload,
  UserPlus,
} from "lucide-react";
import { ToggleChip } from "@/components/app/toggle-chip";
import { AppEmptyState } from "@/components/app/app-empty-state";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  GroupTableHeaderRow,
  groupRows,
  useGroupedListView,
} from "@/components/app/app-list-controls";
import {
  EmptyCell,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query/query-keys";
import {
  listDriverChangeEvents,
  type DriverChangeEventRow,
} from "./driver-change-log-actions";
import {
  DRIVER_CHANGE_SOURCES,
  type DriverChangeSource,
} from "./driver-change-log-shared";

const KUWAIT_TZ = "Asia/Kuwait";

const FILTERS = [
  "all",
  "manual_create",
  "bulk_import",
  "edit",
  "assignment",
  "approve",
  "status",
  "document",
  "asset",
] as const;

const FILTER_ICONS: Record<(typeof FILTERS)[number], LucideIcon> = {
  all: ListFilter,
  manual_create: UserPlus,
  bulk_import: Upload,
  edit: Pencil,
  approve: BadgeCheck,
  status: CircleDot,
  document: FileText,
  asset: Package,
  assignment: MapPin,
};

const KNOWN_FIELDS = new Set([
  "full_name",
  "phone",
  "civil_id",
  "employee_id",
  "driver_code",
  "partner",
  "zone",
  "restaurants",
  "vehicle",
  "nationality",
  "rider_category",
  "client_id",
  "client_name",
  "workflow_status",
  "account_status",
  "blocked",
  "block_reason",
]);

function formatWhen(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: KUWAIT_TZ,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function fieldLabel(
  field: string,
  t: ReturnType<typeof useTranslations<"pages.driverDetail.history">>,
): string {
  if (KNOWN_FIELDS.has(field)) return t(`fields.${field}` as "fields.phone");
  if (field.startsWith("custom.")) return field.slice(7);
  if (field.startsWith("asset.")) return field.slice(6);
  if (field.startsWith("document.")) return field.slice(9);
  return field;
}

export function DriverHistoryTab({ intakeId }: { intakeId: string }) {
  const t = useTranslations("pages.driverDetail.history");
  const locale = useLocale();
  const [source, setSource] = useState<(typeof FILTERS)[number]>("all");

  const query = useInfiniteQuery({
    queryKey: queryKeys.drivers.history(intakeId, source),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listDriverChangeEvents({
        intakeId,
        source,
        cursor: pageParam,
      });
      if ("error" in result) throw new Error(result.error);
      return result;
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  const rows: DriverChangeEventRow[] = useMemo(
    () => query.data?.pages.flatMap((page) => page.rows) ?? [],
    [query.data],
  );
  const historyColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "when", label: t("colWhen") },
      { id: "who", label: t("colWho"), locked: true },
      { id: "what", label: t("colWhat"), categorical: true },
      { id: "changes", label: t("colChanges") },
    ],
    [t],
  );
  const prefs = useTablePrefs(`driver-history-${intakeId}`, historyColumns);
  const filteredRows = useMemo(() => {
    const queryText = prefs.appliedQuery.trim().toLowerCase();
    if (!queryText) return rows;
    return rows.filter((row) =>
      [
        row.actor_name,
        row.source,
        ...row.changes.flatMap((change) => [change.field, change.before, change.after]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(queryText),
    );
  }, [prefs.appliedQuery, rows]);
  const groupedRows = useMemo(
    () =>
      groupRows(
        filteredRows,
        prefs.groupBy,
        { what: (row) => row.source },
        {},
        "—",
      ),
    [filteredRows, prefs.groupBy],
  );
  const listView = useGroupedListView(
    groupedRows,
    prefs.groupBy !== "none",
    `${prefs.groupBy}\u0001${prefs.appliedQuery}\u0001${source}`,
  );
  const shownColumns = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border p-4">
        {FILTERS.map((key) => (
          <ToggleChip
            key={key}
            selected={source === key}
            icon={FILTER_ICONS[key]}
            onClick={() => setSource(key)}
          >
            {key === "all" ? t("filterAll") : t(`source.${key}`)}
          </ToggleChip>
        ))}
      </div>

      {query.isError ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t("loadFailed")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("loadFailedHint")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 h-9 cursor-pointer"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : query.isLoading ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted/50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12">
          <AppEmptyState
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        </div>
      ) : (
        <div>
          <AppDataTable
            toolbar={
              <TableToolbar
                prefs={prefs}
                entity={t("colWho")}
                columns={historyColumns}
                rowKind="dynamic"
                filteredCount={filteredRows.length}
                totalCount={rows.length}
              />
            }
            columns={shownColumns.map((column) => ({ id: column.id, label: column.label }))}
            empty={
              filteredRows.length === 0 ? (
                <AppDataTableEmpty>{t("emptyTitle")}</AppDataTableEmpty>
              ) : undefined
            }
          >
            {listView.sections.flatMap((section) => [
              section.showHeader ? (
                <GroupTableHeaderRow
                  key={`g-${section.key}`}
                  colSpan={shownColumns.length}
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
                <AppDataTableRow key={row.id} className="align-top">
                  {shownColumns.map((column) => {
                    switch (column.id) {
                      case "when":
                        return (
                          <TableCell key={column.id} className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                            {formatWhen(row.created_at, locale)}
                          </TableCell>
                        );
                      case "who":
                        return (
                          <TableCell key={column.id} className="text-xs">
                            <TableNameCell name={row.actor_name} />
                          </TableCell>
                        );
                      case "what":
                        return (
                          <TableCell key={column.id} className="text-xs">
                            <span className="inline-flex rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-xs font-semibold">
                              {DRIVER_CHANGE_SOURCES.includes(row.source)
                                ? t(`source.${row.source}`)
                                : row.source}
                            </span>
                          </TableCell>
                        );
                      case "changes":
                        return (
                          <TableCell key={column.id} className="text-xs">
                            {row.changes.length === 0 ? (
                              typeof row.context.note === "string" && row.context.note.trim() ? (
                                <span className="text-muted-foreground">{row.context.note}</span>
                              ) : (
                                <EmptyCell />
                              )
                            ) : (
                              <ul className="space-y-0.5">
                                {row.changes.map((change) => (
                                  <li key={change.field} className="flex flex-wrap gap-x-2">
                                    <span className="font-medium text-foreground">
                                      {fieldLabel(change.field, t)}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {change.before ?? "—"}
                                    </span>
                                    <span className="text-muted-foreground">→</span>
                                    <span className="text-foreground">{change.after ?? "—"}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </TableCell>
                        );
                      default:
                        return null;
                    }
                  })}
                </AppDataTableRow>
              )),
            ])}
          </AppDataTable>
          {query.hasNextPage ? (
            <div className="border-t border-border p-3 text-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 cursor-pointer gap-1 text-xs"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                {t("loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
