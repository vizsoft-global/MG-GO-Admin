"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { TabBar } from "@/components/dashboard/tab-bar";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { Link, useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  DOCUMENT_EXPIRY_BUCKETS,
  type DocumentExpiryBucket,
  type DocumentExpiryRow,
} from "./document-expiry-utils";
import { DocumentExpiryUpdateSheet } from "./document-expiry-update-sheet";
import { fetchDocumentExpirySignedUrl } from "./document-expiry-actions";
import { useDocumentExpiryDashboard } from "./use-document-expiry";

function statusVariant(row: DocumentExpiryRow): "danger" | "warning" | "success" | "neutral" {
  if (row.bucket === "expired") return "danger";
  if (row.bucket === "week") return "warning";
  if (row.bucket === "month") return "warning";
  return "success";
}

export function DocumentExpiryPageShell() {
  const t = useTranslations("pages.documentExpiry");
  const tDocs = useTranslations("pages.driverNew.documents");
  const { can } = useAuth();
  const canManage = can("documents.manage") || can("drivers.manage");
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data, isLoading, refetch, isFetching } = useDocumentExpiryDashboard();
  const [bucket, setBucket] = useState<DocumentExpiryBucket>("expired");
  const [search, setSearch] = useState("");
  const [activeRow, setActiveRow] = useState<DocumentExpiryRow | null>(null);
  const [sheetMode, setSheetMode] = useState<"date" | "replace" | null>(null);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const needle = search.trim().toLowerCase();
    return all.filter((row) => {
      if (row.bucket !== bucket) return false;
      if (!needle) return true;
      return (
        row.driverName.toLowerCase().includes(needle) ||
        row.driverCode.toLowerCase().includes(needle) ||
        tDocs(row.docType).toLowerCase().includes(needle)
      );
    });
  }, [data?.rows, bucket, search, tDocs]);

  const summary = data?.summary ?? { expired: 0, week: 0, month: 0, quarter: 0 };

  const openView = async (row: DocumentExpiryRow) => {
    if (!row.objectKey) {
      toast.error(t("viewUnavailable"));
      return;
    }
    const result = await fetchDocumentExpirySignedUrl(row.objectKey);
    if (result.error || !result.url) {
      toast.error(t("viewUnavailable"));
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.documentExpiry.all() });
    await refetch();
  };

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-lg"
            disabled={isFetching}
            onClick={() => void invalidate()}
          >
            <RefreshCw className={cn("me-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            {t("refresh")}
          </Button>
        }
      />

      <KpiGrid
        items={[
          { label: t("kpi.expired"), value: summary.expired, accent: "danger" },
          { label: t("kpi.week"), value: summary.week, accent: "warning" },
          { label: t("kpi.month"), value: summary.month, accent: "warning" },
          { label: t("kpi.quarter"), value: summary.quarter, accent: "success" },
        ]}
      />

      <TabBar
        activeId={bucket}
        onSelect={(value) => setBucket(value as DocumentExpiryBucket)}
        items={DOCUMENT_EXPIRY_BUCKETS.map((key) => ({
          id: key,
          label: `${t(`tabs.${key}`)} (${summary[key]})`,
        }))}
      />

      <AppListCard className="mt-2">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Input
            className="h-9 max-w-xs"
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
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
              { id: "driver", label: t("columns.driver") },
              { id: "document", label: t("columns.document") },
              { id: "expires", label: t("columns.expires") },
              { id: "status", label: t("columns.status") },
              { id: "actions", label: t("columns.actions") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => {
                  if (row.driverId) {
                    router.push(`/drivers/${row.driverId}?tab=documents`);
                  }
                }}
              >
                <TableCell>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.driverName}</p>
                    <p className="text-[11px] text-muted-foreground">{row.driverCode}</p>
                    {row.driverId ? (
                      <Link
                        href={`/drivers/${row.driverId}`}
                        className="text-[10px] text-primary hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {t("viewDriver")}
                      </Link>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-sm">{tDocs(row.docType)}</TableCell>
                <TableCell className="text-sm tabular-nums">{row.expiresAt}</TableCell>
                <TableCell>
                  <StatusPill variant={statusVariant(row)}>
                    {row.bucket === "expired"
                      ? t("status.expired", { days: Math.abs(row.daysUntil) })
                      : t("status.daysLeft", { days: row.daysUntil })}
                  </StatusPill>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1" onClick={(event) => event.stopPropagation()}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 cursor-pointer gap-1 px-2 text-[11px] text-primary hover:bg-primary/10"
                      onClick={() => void openView(row)}
                    >
                      <ExternalLink className="h-3 w-3" />
                      {t("actions.view")}
                    </Button>
                    {canManage && row.intakeId ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 cursor-pointer gap-1 px-2 text-[11px] text-primary hover:bg-primary/10"
                          onClick={() => {
                            setActiveRow(row);
                            setSheetMode("date");
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                          {t("actions.updateDate")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 cursor-pointer gap-1 px-2 text-[11px] text-primary hover:bg-primary/10"
                          onClick={() => {
                            setActiveRow(row);
                            setSheetMode("replace");
                          }}
                        >
                          <Upload className="h-3 w-3" />
                          {t("actions.replace")}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>

      <DocumentExpiryUpdateSheet
        open={Boolean(activeRow && sheetMode)}
        mode={sheetMode}
        row={activeRow}
        onOpenChange={(open) => {
          if (!open) {
            setActiveRow(null);
            setSheetMode(null);
          }
        }}
        onSaved={() => void invalidate()}
      />
    </AppPage>
  );
}
