"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { useEsignRequestsList } from "./use-esign";
import type { EsignRequestStatus } from "./types";

const STATUS_FILTERS = ["all", "pending", "signed"] as const;

function statusVariant(
  status: EsignRequestStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "signed") return "success";
  if (status === "expired" || status === "cancelled") return "danger";
  if (status === "pending") return "warning";
  return "neutral";
}

export function EsignSignaturesShell() {
  const t = useTranslations("pages.requests.esign.signatures");
  const tCommon = useTranslations("pages.requests.esign");
  const router = useRouter();
  const [statusFilter, setStatusFilter] =
    useState<(typeof STATUS_FILTERS)[number]>("all");

  const filters = useMemo(
    () => ({
      status:
        statusFilter === "all"
          ? null
          : (statusFilter as EsignRequestStatus),
    }),
    [statusFilter],
  );

  const { data, isLoading, isFetching, refetch } = useEsignRequestsList(filters);
  const rows = data?.rows ?? [];

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tCommon("hub.requests"), href: "/requests" },
          { label: tCommon("hub.title"), href: "/requests/esign" },
          { label: t("title") },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter(v as (typeof STATUS_FILTERS)[number])
              }
            >
              <SelectTrigger className="h-9 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`filters.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <RefreshCw
                className={cn("me-1.5 h-3.5 w-3.5", isFetching && "animate-spin")}
              />
              {t("refresh")}
            </Button>
          </div>
        }
      />

      <AppListCard className="mt-2">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "code", label: t("colCode") },
              { id: "driver", label: t("colDriver") },
              { id: "title", label: t("colTitle") },
              { id: "signedAt", label: t("colSignedAt") },
              { id: "signer", label: t("colSigner") },
              { id: "status", label: t("colStatus") },
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
                <TableCell className="text-sm">
                  <div>{row.driver_name}</div>
                  <div className="text-[11px] text-muted-foreground">{row.driver_code}</div>
                </TableCell>
                <TableCell className="max-w-[180px] truncate text-sm">{row.title}</TableCell>
                <TableCell className="text-sm tabular-nums">
                  {row.signed_at
                    ? new Date(row.signed_at).toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "—"}
                </TableCell>
                <TableCell className="text-sm">{row.signer_display_name ?? "—"}</TableCell>
                <TableCell>
                <StatusPill variant={statusVariant(row.status)}>
                  {tCommon(`status.${row.status}`)}
                </StatusPill>
                </TableCell>
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
