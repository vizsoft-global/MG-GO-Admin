"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Ban, CheckCircle2, ClipboardList, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { GroupedSections, groupRows } from "@/components/app/app-list-controls";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { VisibleTableCell } from "@/components/app/visible-table-cell";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { OrderExceptionReviewDialog } from "./order-exception-review-dialog";
import { downloadOrderExceptionsXlsx } from "./order-exceptions-xlsx";
import {
  orderExceptionErrorMessage,
  useExportOrderExceptions,
  useOrderExceptionProofs,
  useOrderExceptionSummary,
  useOrderExceptionsList,
  useReviewOrderException,
} from "./use-order-exceptions";
import {
  ORDER_EXCEPTION_PAGE_SIZE,
  type OrderExceptionKindFilter,
  type OrderExceptionRow,
  type OrderExceptionSourceFilter,
  type OrderExceptionStatus,
  type OrderExceptionStatusFilter,
} from "./types";

const STATUS_TONE: Record<OrderExceptionStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
};

const ORDER_EXCEPTION_COLUMNS = [
  "rider",
  "order",
  "kind",
  "source",
  "reason",
  "proof",
  "day",
  "status",
  "reviewed",
] as const;

type OrderExceptionColumnId = (typeof ORDER_EXCEPTION_COLUMNS)[number];

const CELL_CLASS: Record<OrderExceptionColumnId, string> = {
  rider: "max-w-[180px]",
  order: "font-mono text-xs",
  kind: "text-xs",
  source: "text-xs",
  reason: "max-w-[220px] truncate text-xs",
  proof: "text-xs tabular-nums",
  day: "text-xs tabular-nums",
  status: "",
  reviewed: "max-w-[140px] truncate text-xs text-muted-foreground",
};

function isOrderExceptionColumnId(id: string): id is OrderExceptionColumnId {
  switch (id) {
    case "rider":
    case "order":
    case "kind":
    case "source":
    case "reason":
    case "proof":
    case "day":
    case "status":
    case "reviewed":
      return true;
    default:
      return false;
  }
}

function statusLabel(
  t: ReturnType<typeof useTranslations<"pages.orderExceptions">>,
  status: OrderExceptionStatus,
) {
  if (status === "pending") return t("statusPending");
  if (status === "approved") return t("statusApproved");
  return t("statusRejected");
}

export function OrderExceptionsPageShell() {
  const t = useTranslations("pages.orderExceptions");
  const toolbarColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "rider", label: t("colRider"), locked: true },
      { id: "order", label: t("colOrder") },
      { id: "kind", label: t("colKind") },
      { id: "source", label: t("colSource") },
      { id: "reason", label: t("colReason") },
      { id: "proof", label: t("colProof") },
      { id: "day", label: t("colDay") },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "reviewed", label: t("colReviewed") },
    ],
    [t],
  );
  const prefs = useTablePrefs("order-exceptions", toolbarColumns);
  const appliedSearch = prefs.appliedQuery.trim();
  const [tab, setTab] = useState<OrderExceptionStatusFilter>("pending");
  const [kind, setKind] = useState<OrderExceptionKindFilter>("all");
  const [source, setSource] = useState<OrderExceptionSourceFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [selected, setSelected] = useState<OrderExceptionRow | null>(null);

  const range = useMemo(
    () => ({ from: from || undefined, to: to || undefined }),
    [from, to],
  );
  const slow = Boolean(appliedSearch || range.from || range.to);
  const filters = useMemo(
    () => ({
      status: tab,
      kind,
      source,
      ...(range.from ? { from: range.from } : {}),
      ...(range.to ? { to: range.to } : {}),
      ...(appliedSearch ? { search: appliedSearch } : {}),
      limit: ORDER_EXCEPTION_PAGE_SIZE,
      offset: slow ? page * ORDER_EXCEPTION_PAGE_SIZE : 0,
      cursor: slow ? null : (cursors[page] ?? null),
    }),
    [tab, kind, source, range.from, range.to, appliedSearch, page, cursors, slow],
  );

  const list = useOrderExceptionsList(filters);
  const summary = useOrderExceptionSummary(range);
  /**
   * Proofs arrive signed on the row. The fallback query only runs when the row had
   * screenshots but none of them could be signed on the way out.
   */
  const reSignProofs = useOrderExceptionProofs(
    selected?.id ?? "",
    Boolean(selected && selected.proof_count > 0 && selected.proofs.length === 0),
  );
  const review = useReviewOrderException();
  const exportRows = useExportOrderExceptions();

  const proofs = reSignProofs.data ?? selected?.proofs ?? [];
  const proofsLoading =
    selected !== null &&
    selected.proofs.length === 0 &&
    selected.proof_count > 0 &&
    reSignProofs.isLoading;

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const nextCursor = list.data?.nextCursor ?? null;
  const counts = summary.data;
  const pageStart = page * ORDER_EXCEPTION_PAGE_SIZE;
  const hasFilters =
    kind !== "all" || source !== "all" || Boolean(from) || Boolean(to) || Boolean(appliedSearch);

  function resetPage() {
    setPage(0);
    setCursors([null]);
  }

  useEffect(() => {
    if (slow) return;
    setCursors((prev) => {
      if (prev[page + 1] === nextCursor) return prev;
      const copy = prev.slice(0, page + 1);
      copy[page + 1] = nextCursor;
      return copy;
    });
  }, [nextCursor, page, slow]);

  const appliedSearchRef = useRef(appliedSearch);
  useEffect(() => {
    if (appliedSearchRef.current === appliedSearch) return;
    appliedSearchRef.current = appliedSearch;
    setPage(0);
    setCursors([null]);
  }, [appliedSearch]);

  const kindItems = [
    { value: "all", label: t("kindAll") },
    { value: "rejected", label: t("kindRejected") },
    { value: "cancelled", label: t("kindCancelled") },
  ];
  const sourceItems = [
    { value: "all", label: t("sourceAll") },
    { value: "driver_declined", label: t("sourceDriver") },
    { value: "store_or_customer", label: t("sourceStore") },
  ];

  const errorCode = list.error ? orderExceptionErrorMessage(list.error) : null;

  const grouped = useMemo(
    () =>
      groupRows(
        rows,
        prefs.groupBy,
        { status: (row) => row.status },
        {
          pending: t("statusPending"),
          approved: t("statusApproved"),
          rejected: t("statusRejected"),
        },
        "—",
      ),
    [prefs.groupBy, rows, t],
  );
  const tableColumns = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));

  function orderCell(columnId: OrderExceptionColumnId, row: OrderExceptionRow): ReactNode {
    switch (columnId) {
      case "rider":
        return (
          <>
            <TableNameCell name={row.driver_name} />
            {row.driver_code ? (
              <p className="truncate font-mono text-xs text-muted-foreground">{row.driver_code}</p>
            ) : null}
          </>
        );
      case "order":
        return row.order_id ? `#${row.order_id}` : "—";
      case "kind":
        switch (row.kind) {
          case "rejected":
            return t("kindRejected");
          case "cancelled":
            return t("kindCancelled");
          default: {
            const _never: never = row.kind;
            return _never;
          }
        }
      case "source":
        switch (row.source) {
          case "driver_declined":
            return t("sourceDriver");
          case "store_or_customer":
            return t("sourceStore");
          default: {
            const _never: never = row.source;
            return _never;
          }
        }
      case "reason":
        return row.reason ?? "—";
      case "proof":
        return row.proof_count > 0 ? t("proofCount", { count: row.proof_count }) : t("proofNone");
      case "day":
        return row.day ?? "—";
      case "status":
        return (
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold",
              STATUS_TONE[row.status],
            )}
          >
            {statusLabel(t, row.status)}
          </span>
        );
      case "reviewed":
        return row.reviewed_by_name ?? "—";
      default: {
        const _never: never = columnId;
        return _never;
      }
    }
  }

  /**
   * The sheet is written from the same controls the list is showing, so an export
   * can never cover a different window than the one on screen. Columns come from the
   * `col*` keys the table already uses — a header cannot drift from its column.
   */
  function handleExport() {
    if (exportRows.isPending) return;
    exportRows.mutate(filters, {
      onSuccess: (result) => {
        if (result.rows.length === 0) {
          toast.error(t("exportEmpty"));
          return;
        }
        downloadOrderExceptionsXlsx({
          filename: `order-exceptions-${kuwaitTodayYmd()}.xlsx`,
          rows: result.rows,
          filters: {
            status: tab,
            kind,
            source,
            from: range.from,
            to: range.to,
            search: appliedSearch || undefined,
          },
          matchedRows: result.matched,
          labels: {
            sheetRows: t("exportSheetRows"),
            sheetSummary: t("exportSheetSummary"),
            columns: [
              t("colDay"),
              t("colRider"),
              t("colDriverCode"),
              t("colOrder"),
              t("colKind"),
              t("colSource"),
              t("colReason"),
              t("colProof"),
              t("colStatus"),
              t("colReviewed"),
              t("colReviewedAt"),
              t("colNote"),
              t("colCreated"),
              t("colCounted"),
            ],
            kind: { rejected: t("kindRejected"), cancelled: t("kindCancelled") },
            source: { driver_declined: t("sourceDriver"), store_or_customer: t("sourceStore") },
            status: {
              pending: t("statusPending"),
              approved: t("statusApproved"),
              rejected: t("statusRejected"),
            },
            counted: { yes: t("countedYes"), no: t("countedNo") },
            summary: {
              filters: t("summaryFilters"),
              status: t("summaryStatus"),
              kind: t("summaryKind"),
              source: t("summarySource"),
              from: t("summaryFrom"),
              to: t("summaryTo"),
              search: t("summarySearch"),
              all: t("summaryAll"),
              exportedRows: t("summaryExported"),
              matchedRows: t("summaryMatched"),
              capped: t("summaryCapped"),
            },
          },
        });
        if (result.capped) {
          toast.warning(
            t("exportCapped", { exported: result.rows.length, matched: result.matched }),
          );
        } else {
          toast.success(t("exportDone", { count: result.rows.length }));
        }
      },
      onError: () => toast.error(t("exportFailed")),
    });
  }

  return (
    <AppPage className="space-y-3">
      <AppPageHeader title={t("title")} description={t("subtitle")} />
      <KpiGrid
        items={[
          { label: t("kpiPending"), value: counts?.pending ?? "—", icon: Clock, accent: "warning" },
          { label: t("kpiApproved"), value: counts?.approved ?? "—", icon: CheckCircle2, accent: "success" },
          { label: t("kpiRejected"), value: counts?.rejected ?? "—", icon: Ban, accent: "danger" },
          { label: t("kpiTotal"), value: counts?.total ?? "—", icon: ClipboardList, accent: "primary" },
          { label: t("kpiRejectedOrders"), value: counts?.rejected_orders ?? "—", accent: "default" },
          { label: t("kpiCancelledOrders"), value: counts?.cancelled_orders ?? "—", accent: "default" },
        ]}
      />
      <TabBar
        activeId={tab}
        onSelect={(id) => {
          setTab(id as OrderExceptionStatusFilter);
          resetPage();
        }}
        items={[
          { id: "all", label: t("tabAll") },
          { id: "pending", label: t("tabPending") },
          { id: "approved", label: t("tabApproved") },
          { id: "rejected", label: t("tabRejected") },
        ]}
      />
      <AppListCard
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              items={kindItems}
              value={kind}
              onValueChange={(value) => {
                if (!value) return;
                setKind(value as OrderExceptionKindFilter);
                resetPage();
              }}
            >
              <SelectTrigger className="h-9 w-[140px] cursor-pointer text-xs" aria-label={t("filterKind")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kindItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={sourceItems}
              value={source}
              onValueChange={(value) => {
                if (!value) return;
                setSource(value as OrderExceptionSourceFilter);
                resetPage();
              }}
            >
              <SelectTrigger className="h-9 w-[160px] cursor-pointer text-xs" aria-label={t("filterSource")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sourceItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={from}
              aria-label={t("filterFrom")}
              onChange={(event) => {
                setFrom(event.target.value);
                resetPage();
              }}
              className="h-9 w-[140px]"
            />
            <Input
              type="date"
              value={to}
              aria-label={t("filterTo")}
              onChange={(event) => {
                setTo(event.target.value);
                resetPage();
              }}
              className="h-9 w-[140px]"
            />
          </div>
        }
      >
        <div className="border-b border-border">
          <TableToolbar
            prefs={prefs}
            entity={t("title")}
            columns={toolbarColumns}
            rowKind="dynamic"
            entityList
            filteredCount={total}
            totalCount={total}
            onExport={handleExport}
          />
        </div>
        {list.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        ) : errorCode ? (
          <AppDataTableEmpty>
            <p className="text-sm font-medium text-foreground">
              {errorCode === "not_authorized" ? t("errorNotAuthorized") : t("errorGeneric")}
            </p>
          </AppDataTableEmpty>
        ) : rows.length === 0 ? (
          <AppDataTableEmpty>
            <p className="text-sm font-medium text-foreground">
              {hasFilters || tab !== "all" ? t("emptyFilters") : t("emptyTitle")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t("emptyHint")}</p>
          </AppDataTableEmpty>
        ) : prefs.view === "grid" ? (
          <div className="p-4">
            <GroupedSections groups={grouped}>
              {(groupRowsList) => (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {groupRowsList.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setSelected(row)}
                      className="cursor-pointer rounded-xl border border-border bg-card p-4 text-start shadow-sm hover:bg-muted/40"
                    >
                      <TableNameCell name={row.driver_name} />
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {row.order_id ? `#${row.order_id}` : "—"}
                      </p>
                      <div className="mt-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold",
                            STATUS_TONE[row.status],
                          )}
                        >
                          {statusLabel(t, row.status)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </GroupedSections>
          </div>
        ) : (
          <AppDataTable
            stickyHeader
            columns={tableColumns.map((column) => ({ id: column.id, label: column.label }))}
          >
            {grouped.flatMap((group) => [
              ...(prefs.groupBy !== "none"
                ? [
                    <AppDataTableRow key={`group-${group.key}`} className="hover:bg-transparent">
                      <TableCell
                        colSpan={tableColumns.length}
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
                <AppDataTableRow key={row.id} onClick={() => setSelected(row)}>
                  {tableColumns.map((column) =>
                    isOrderExceptionColumnId(column.id) ? (
                      <VisibleTableCell
                        key={column.id}
                        columnId={column.id}
                        isVisible={prefs.isVisible}
                        className={CELL_CLASS[column.id]}
                      >
                        {orderCell(column.id, row)}
                      </VisibleTableCell>
                    ) : null,
                  )}
                </AppDataTableRow>
              )),
            ])}
          </AppDataTable>
        )}
        {total > ORDER_EXCEPTION_PAGE_SIZE || page > 0 ? (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={page === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              {t("pagePrev")}
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {pageStart + 1}–{Math.min(pageStart + ORDER_EXCEPTION_PAGE_SIZE, total)} / {total}
            </span>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={
                slow
                  ? pageStart + ORDER_EXCEPTION_PAGE_SIZE >= total
                  : nextCursor == null
              }
              onClick={() => setPage((value) => value + 1)}
            >
              {t("pageNext")}
            </Button>
          </div>
        ) : null}
      </AppListCard>

      <OrderExceptionReviewDialog
        row={selected}
        open={Boolean(selected)}
        proofs={proofs}
        proofsLoading={proofsLoading}
        submitting={review.isPending}
        actionError={
          review.error
            ? orderExceptionErrorMessage(review.error) === "review_note_required"
              ? t("reviewNoteRequired")
              : orderExceptionErrorMessage(review.error) === "not_authorized"
                ? t("errorNotAuthorized")
                : t("errorGeneric")
            : null
        }
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onConfirm={(input) => {
          review.mutate(input, {
            onSuccess: (result) => {
              toast.success(result.status === "approved" ? t("approved") : t("declined"));
              setSelected(null);
            },
          });
        }}
      />
    </AppPage>
  );
}
