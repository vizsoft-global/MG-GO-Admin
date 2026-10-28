"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  CircleSlash,
  Clock,
  ExternalLink,
  FileSignature,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { groupRows } from "@/components/app/app-list-controls";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import {
  EmptyCell,
  TableGridCards,
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { EsignKpiStrip } from "./esign-kpi-strip";
import { useEsignRequestsList, useEsignStatusCounts } from "./use-esign";
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

export function EsignSignaturesShell() {
  const t = useTranslations("pages.requests.esign.signatures");
  const tCommon = useTranslations("pages.requests.esign");
  const router = useRouter();
  const [statusTab, setStatusTab] = useState<StatusTab>("all");

  const filters = useMemo(
    () => ({
      status: statusTab === "all" ? null : (statusTab as EsignRequestStatus),
    }),
    [statusTab],
  );

  const { data, isLoading, isFetching, refetch } = useEsignRequestsList(filters);
  const { data: counts } = useEsignStatusCounts();
  const rows = data?.rows ?? [];
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "ref", label: t("colCode"), locked: true },
      { id: "document", label: t("colDocument"), locked: true },
      { id: "recipient", label: t("colRecipient"), locked: true },
      { id: "category", label: t("colCategory"), categorical: true },
      { id: "status", label: t("colStatus"), categorical: true },
      { id: "sent", label: t("colSent") },
      { id: "signedOn", label: t("colSignedOn") },
    ],
    [t],
  );
  const prefs = useTablePrefs("esign.signatures", columns);
  const shown = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));
  const filtered = useMemo(() => {
    const q = prefs.appliedQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.request_code, row.title, row.driver_name, row.driver_code, row.category_label]
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

  function tabCount(tab: StatusTab): number | null {
    if (!counts) return null;
    return tab === "all" ? counts.all : counts[tab];
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tCommon("hub.title"), href: "/requests/esign" },
          { label: t("title") },
        ]}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw className={cn("me-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            {t("refresh")}
          </Button>
        }
      />

      {/* Figma ESign 02 shows four equal full-width KPI cards; the shared KpiGrid is a
          six-column strip, which would leave a third of the row empty and clip the labels. */}
      <EsignKpiStrip
        items={[
          {
            label: t("kpiPending"),
            value: counts?.pending ?? "—",
            icon: Clock,
            accent: "warning",
            caption: t("kpiPendingCaption"),
          },
          {
            label: t("kpiSigned"),
            value: counts?.signedLast30d ?? "—",
            icon: FileSignature,
            accent: "success",
            caption: t("kpiSignedCaption"),
          },
          {
            label: t("kpiRejected"),
            value: counts?.declined ?? "—",
            icon: XCircle,
            accent: "danger",
            caption: t("kpiRejectedCaption"),
          },
          {
            label: t("kpiExpired"),
            value: counts?.expired ?? "—",
            icon: CircleSlash,
            caption: t("kpiExpiredCaption"),
          },
        ]}
      />

      <AppListCard className="p-0">
        <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
          {STATUS_TABS.map((tab) => {
            const count = tabCount(tab);
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusTab(tab)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                  statusTab === tab
                    ? "bg-primary/10 text-primary"
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

        <TableToolbar
          prefs={prefs}
          entity={t("title")}
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
                { label: t("colRecipient"), value: row.driver_name },
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
                  ref: (
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
                  document: row.title ? <TableNameCell name={row.title} /> : <EmptyCell />,
                  recipient: (
                    <>
                      <div>{row.driver_name || <EmptyCell />}</div>
                      <div className="text-xs text-muted-foreground">{row.driver_code}</div>
                    </>
                  ),
                  category: row.category_label || <EmptyCell />,
                  status: (
                    <StatusPill variant={statusVariant(row.status)}>
                      {tCommon(`status.${row.status}`)}
                    </StatusPill>
                  ),
                  sent: row.created_at ? formatDay(row.created_at) : <EmptyCell />,
                  signedOn: row.signed_at ? formatDay(row.signed_at) : <EmptyCell />,
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
      </AppListCard>
    </AppPage>
  );
}
