"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Ban, CheckCircle2, ClipboardList, Clock, Download, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableEmpty,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
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
  const [tab, setTab] = useState<OrderExceptionStatusFilter>("pending");
  const [kind, setKind] = useState<OrderExceptionKindFilter>("all");
  const [source, setSource] = useState<OrderExceptionSourceFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [selected, setSelected] = useState<OrderExceptionRow | null>(null);

  const range = useMemo(
    () => ({ from: from || undefined, to: to || undefined }),
    [from, to],
  );
  const slow = Boolean(debouncedSearch || range.from || range.to);
  const filters = useMemo(
    () => ({
      status: tab,
      kind,
      source,
      ...(range.from ? { from: range.from } : {}),
      ...(range.to ? { to: range.to } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      limit: ORDER_EXCEPTION_PAGE_SIZE,
      offset: slow ? page * ORDER_EXCEPTION_PAGE_SIZE : 0,
      cursor: slow ? null : (cursors[page] ?? null),
    }),
    [tab, kind, source, range.from, range.to, debouncedSearch, page, cursors, slow],
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
    kind !== "all" || source !== "all" || Boolean(from) || Boolean(to) || Boolean(debouncedSearch);

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

  /**
   * The sheet is written from the same controls the list is showing, so an export
   * can never cover a different window than the one on screen. Columns come from the
   * `col*` keys the table already uses — a header cannot drift from its column.
   */
  function handleExport() {
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
            search: debouncedSearch || undefined,
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
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onBlur={() => {
                  setDebouncedSearch(search.trim());
                  resetPage();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  setDebouncedSearch(search.trim());
                  resetPage();
                }}
                placeholder={t("searchPlaceholder")}
                className="h-9 ps-8"
              />
            </div>
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
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={exportRows.isPending}
              onClick={handleExport}
            >
              {exportRows.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {exportRows.isPending ? t("exporting") : t("export")}
            </Button>
          </div>
        }
      >
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
        ) : (
          <AppDataTable
            stickyHeader
            columns={[
              { id: "rider", label: t("colRider") },
              { id: "order", label: t("colOrder") },
              { id: "kind", label: t("colKind") },
              { id: "source", label: t("colSource") },
              { id: "reason", label: t("colReason") },
              { id: "proof", label: t("colProof") },
              { id: "day", label: t("colDay") },
              { id: "status", label: t("colStatus") },
              { id: "reviewed", label: t("colReviewed") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow key={row.id} onClick={() => setSelected(row)}>
                <TableCell className="max-w-[180px]">
                  <p className="truncate text-sm font-medium">{row.driver_name ?? "—"}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {row.driver_code ?? ""}
                  </p>
                </TableCell>
                <TableCell className="font-mono text-xs">{row.order_id ? `#${row.order_id}` : "—"}</TableCell>
                <TableCell className="text-xs">
                  {row.kind === "rejected" ? t("kindRejected") : t("kindCancelled")}
                </TableCell>
                <TableCell className="text-xs">
                  {row.source === "driver_declined" ? t("sourceDriver") : t("sourceStore")}
                </TableCell>
                <TableCell className="max-w-[220px] truncate text-xs">{row.reason ?? "—"}</TableCell>
                <TableCell className="text-xs tabular-nums">
                  {row.proof_count > 0
                    ? t("proofCount", { count: row.proof_count })
                    : t("proofNone")}
                </TableCell>
                <TableCell className="text-xs tabular-nums">{row.day ?? "—"}</TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold",
                      STATUS_TONE[row.status],
                    )}
                  >
                    {statusLabel(t, row.status)}
                  </span>
                </TableCell>
                <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">
                  {row.reviewed_by_name ?? "—"}
                </TableCell>
              </AppDataTableRow>
            ))}
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
