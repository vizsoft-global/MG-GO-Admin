"use client";

import { useMemo, useState } from "react";
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
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
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

      <KpiGrid
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
                  <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "ref", label: t("colCode") },
              { id: "document", label: t("colDocument") },
              { id: "recipient", label: t("colRecipient") },
              { id: "category", label: t("colCategory") },
              { id: "status", label: t("colStatus") },
              { id: "sent", label: t("colSent") },
              { id: "signedOn", label: t("colSignedOn") },
              { id: "actions", label: t("colActions") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => router.push(`/requests/esign/${row.id}`)}
              >
                <TableCell className="font-mono text-xs">{row.request_code}</TableCell>
                <TableCell className="max-w-[200px] truncate text-sm font-medium">
                  {row.title}
                </TableCell>
                <TableCell className="text-sm">
                  <div>{row.driver_name}</div>
                  <div className="text-[11px] text-muted-foreground">{row.driver_code}</div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.category_label ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusPill variant={statusVariant(row.status)}>
                    {tCommon(`status.${row.status}`)}
                  </StatusPill>
                </TableCell>
                <TableCell className="text-sm tabular-nums">{formatDay(row.created_at)}</TableCell>
                <TableCell className="text-sm tabular-nums">{formatDay(row.signed_at)}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-primary hover:bg-primary/10"
                    render={<Link href={`/requests/esign/${row.id}`} />}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="me-1 h-3.5 w-3.5" />
                    {t("viewDetails")}
                  </Button>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>
    </AppPage>
  );
}
