"use client";

import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { useEsignBatches } from "./use-esign";
import type { EsignBatchStatus } from "./types";

function variant(status: EsignBatchStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "completed") return "success";
  if (status === "partial") return "warning";
  if (status === "processing") return "warning";
  return "neutral";
}

export function EsignBatchesShell() {
  const t = useTranslations("pages.requests.esign.batches");
  const tHub = useTranslations("pages.requests.esign.hub");
  const router = useRouter();
  const { data, isLoading } = useEsignBatches();
  const rows = data?.rows ?? [];

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("subtitle")}
        breadcrumbs={[
          { label: tHub("requests"), href: "/requests" },
          { label: tHub("title"), href: "/requests/esign" },
          { label: t("title") },
        ]}
        actions={
          <Button variant="outline" size="sm" className="h-9" render={<Link href="/requests/esign" />}>
            {t("back")}
          </Button>
        }
      />
      <AppListCard className="p-0">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data?.error ? (
          <AppEmptyState title={t("emptyTitle")} description={data.error} />
        ) : rows.length === 0 ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "code", label: t("colCode") },
              { id: "title", label: t("colTitle") },
              { id: "template", label: t("colTemplate") },
              { id: "counts", label: t("colCounts") },
              { id: "status", label: t("colStatus") },
            ]}
          >
            {rows.map((row) => (
              <AppDataTableRow
                key={row.id}
                className="cursor-pointer"
                onClick={() => router.push(`/requests/esign/batches/${row.id}`)}
              >
                <TableCell className="font-mono text-xs">
                  {row.batch_code}
                  <Link
                    href={`/requests/esign/batches/${row.id}`}
                    className="mt-0.5 flex items-center gap-1 font-sans text-[10px] text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t("viewDetails")}
                  </Link>
                </TableCell>
                <TableCell className="text-sm font-medium">{row.title}</TableCell>
                <TableCell className="text-sm">{row.template_name ?? "—"}</TableCell>
                <TableCell className="text-sm tabular-nums">
                  {row.created_count}/{row.total_count}
                  {row.failed_count > 0 ? ` · ${row.failed_count}` : ""}
                </TableCell>
                <TableCell>
                  <StatusPill variant={variant(row.status)}>{t(`status.${row.status}`)}</StatusPill>
                </TableCell>
              </AppDataTableRow>
            ))}
          </AppDataTable>
        )}
      </AppListCard>
    </AppPage>
  );
}
