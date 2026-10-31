"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";
import { AppEmptyState } from "@/components/app";
import { groupRows } from "@/components/app/app-list-controls";
import { AppDataTable, AppDataTableRow, TableCell } from "@/components/app/app-data-table";
import {
  EmptyCell,
  TableGridCards,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { StatusPill } from "@/components/dashboard/status-pill";
import { SearchSelect } from "@/components/ui/search-select";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useEsignBatches, useEsignRequestsList, useEsignStatusCounts, useEsignTemplates } from "./use-esign";
import type { EsignRequestStatus } from "./types";

const STATUS_TABS = ["all", "pending", "signed", "declined", "expired"] as const;

type StatusTab = (typeof STATUS_TABS)[number];

function statusVariant(
  status: EsignRequestStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "signed") return "success";
  if (status === "declined") return "danger";
  if (status === "expired" || status === "cancelled") return "neutral";
  if (status === "pending") return "warning";
  return "neutral";
}

function formatDay(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });
}

/**
 * Individual (one-rider) rows that used to live on Sent requests.
 *
 * Filters sit in a vertical rail so this panel can share the Sent for signature
 * page with the batch tracker without a second horizontal toolbar.
 */
export function EsignIndividualSentPanel() {
  const t = useTranslations("pages.requests.esign.sent");
  const tCommon = useTranslations("pages.requests.esign");
  const tTracker = useTranslations("pages.requests.esign.tracker");
  const router = useRouter();
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);

  const listFilters = useMemo(
    () => ({
      status: statusTab === "all" ? null : (statusTab as EsignRequestStatus),
      template_id: templateId,
      batch_id: batchId,
    }),
    [statusTab, templateId, batchId],
  );

  const { data, isLoading } = useEsignRequestsList(listFilters);
  const { data: counts } = useEsignStatusCounts();
  const { data: templatesData } = useEsignTemplates();
  const { data: batchesData } = useEsignBatches();
  const rows = data?.rows ?? [];
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "code", label: t("colCode"), locked: true },
      { id: "driver", label: t("colDriver"), locked: true },
      { id: "title", label: t("colTitle"), locked: true },
      { id: "category", label: t("colCategory"), categorical: true },
      { id: "batch", label: t("colBatch") },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "sent", label: t("colSent") },
      { id: "due", label: t("colDue") },
    ],
    [t],
  );
  const prefs = useTablePrefs("esign.individualSent", columns);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));
  const filtered = useMemo(() => {
    const q = prefs.appliedQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.request_code, row.driver_name, row.driver_code, row.title, row.category_label, row.batch_code]
        .some((value) => (value ?? "").toLowerCase().includes(q)),
    );
  }, [prefs.appliedQuery, rows]);
  const grouped = useMemo(
    () =>
      groupRows(
        filtered,
        prefs.groupBy,
        {
          category: (row) => row.category_label ?? "",
          status: (row) => tCommon(`status.${row.status}`),
        },
        {},
        "—",
      ),
    [filtered, prefs.groupBy, tCommon],
  );

  return (
    <div className="grid min-w-0 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
      <aside className="flex flex-col gap-2 border-b border-border p-3 lg:border-b-0 lg:border-e">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {tTracker("scopeIndividual")}
        </p>
        <SearchSelect
          items={(templatesData?.rows ?? []).map((row) => ({
            value: row.id,
            label: row.name_en,
            keywords: [row.name_en, row.category_key, row.id],
          }))}
          value={templateId}
          onChange={setTemplateId}
          placeholder={t("filterTemplate")}
          searchPlaceholder={t("filterTemplateSearch")}
          recentsKey="esign-sent-template"
          className="w-full"
        />
        <SearchSelect
          items={(batchesData?.rows ?? []).map((row) => ({
            value: row.id,
            label: row.batch_code,
            hint: row.title,
            keywords: [row.batch_code, row.title, row.id],
          }))}
          value={batchId}
          onChange={setBatchId}
          placeholder={t("filterBatch")}
          searchPlaceholder={t("filterBatchSearch")}
          recentsKey="esign-sent-batch"
          className="w-full"
        />
        <div className="flex flex-col gap-1">
          {STATUS_TABS.map((tab) => {
            const count = counts == null ? null : tab === "all" ? counts.all : counts[tab];
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusTab(tab)}
                className={cn(
                  "inline-flex h-9 items-center justify-between gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                  statusTab === tab
                    ? "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400/50"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                {t(`filters.${tab}`)}
                {count != null ? (
                  <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </aside>

      <div className="min-w-0">
        <TableToolbar
          prefs={prefs}
          entity={tTracker("scopeIndividual")}
          columns={columns}
          rowKind="dynamic"
          entityList
          filteredCount={filtered.length}
          totalCount={rows.length}
        />
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : prefs.view === "grid" ? (
          <TableGridCards
            rows={filtered.map((row) => ({
              id: row.request_code,
              name: row.title || row.driver_name,
              fields: [
                { label: t("colDriver"), value: row.driver_name },
                { label: t("colCategory"), value: row.category_label || "—" },
                { label: t("colStatus"), value: tCommon(`status.${row.status}`) },
                { label: t("colSent"), value: row.created_at ? formatDay(row.created_at) : "—" },
              ],
              onOpen: () => router.push(`/requests/esign/${row.id}`),
            }))}
          />
        ) : (
          <AppDataTable columns={shown.map((column) => ({ id: column.id, label: column.label }))}>
            {grouped.flatMap((group) => [
              ...(prefs.groupBy !== "none"
                ? [
                    <AppDataTableRow key={`g-${group.key}`}>
                      <TableCell colSpan={shown.length} className="text-xs font-semibold">
                        {group.label} · {group.rows.length}
                      </TableCell>
                    </AppDataTableRow>,
                  ]
                : []),
              ...group.rows.map((row) => {
                const cells: Record<string, ReactNode> = {
                  code: (
                    <>
                      <span className="font-mono text-xs">{row.request_code}</span>
                      <Link
                        href={`/requests/esign/${row.id}`}
                        className="mt-0.5 flex items-center gap-1 font-sans text-xs text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t("viewDetails")}
                      </Link>
                    </>
                  ),
                  driver: (
                    <>
                      <div>{row.driver_name || <EmptyCell />}</div>
                      <div className="text-xs text-muted-foreground">{row.driver_code}</div>
                    </>
                  ),
                  title: row.title ? <TableNameCell name={row.title} /> : <EmptyCell />,
                  category: row.category_label || <EmptyCell />,
                  batch: row.batch_code ? (
                    <span className="font-mono text-xs">{row.batch_code}</span>
                  ) : (
                    <EmptyCell />
                  ),
                  status: (
                    <StatusPill variant={statusVariant(row.status)}>
                      {tCommon(`status.${row.status}`)}
                    </StatusPill>
                  ),
                  sent: row.created_at ? formatDay(row.created_at) : <EmptyCell />,
                  due: row.due_at ? formatDay(row.due_at) : <EmptyCell />,
                };
                return (
                  <AppDataTableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/requests/esign/${row.id}`)}
                  >
                    {shown.map((column) => (
                      <TableCell key={column.id} className="text-sm">
                        {cells[column.id]}
                      </TableCell>
                    ))}
                  </AppDataTableRow>
                );
              }),
            ])}
          </AppDataTable>
        )}
      </div>
    </div>
  );
}
