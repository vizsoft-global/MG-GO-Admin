"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { processEsignBatchChunk } from "./esign-sender-actions";
import { useEsignBatch } from "./use-esign";
import type { EsignBatchRowStatus } from "./types";

function variant(status: EsignBatchRowStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "created") return "success";
  if (status === "failed") return "danger";
  return "neutral";
}

export function EsignBatchDetailShell({ batchId }: { batchId: string }) {
  const t = useTranslations("pages.requests.esign.batches");
  const tHub = useTranslations("pages.requests.esign.hub");
  const queryClient = useQueryClient();
  const { data, isLoading } = useEsignBatch(batchId);
  const [busy, setBusy] = useState(false);
  const batch = data?.batch;
  const lines = data?.lines ?? [];

  async function resume() {
    setBusy(true);
    let remaining = 1;
    while (remaining > 0) {
      const chunk = await processEsignBatchChunk(batchId);
      if (!chunk.ok) {
        toast.error(chunk.error ?? t("errors.processFailed"));
        break;
      }
      remaining = chunk.remaining;
      if (chunk.processed === 0) break;
    }
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: queryKeys.esign.batch(batchId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.esign.batches() });
  }

  if (isLoading) {
    return (
      <AppPage>
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppPage>
    );
  }
  if (!batch) {
    return (
      <AppPage>
        <AppEmptyState title={t("notFound")} description={data?.error ?? t("emptyDescription")} />
      </AppPage>
    );
  }

  const pending = lines.filter((l) => l.status === "pending").length;

  return (
    <AppPage>
      <AppPageHeader
        title={batch.batch_code}
        description={batch.title}
        breadcrumbs={[
          { label: tHub("requests"), href: "/requests" },
          { label: tHub("title"), href: "/requests/esign" },
          { label: t("title"), href: "/requests/esign/batches" },
          { label: batch.batch_code },
        ]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-9" render={<Link href="/requests/esign/batches" />}>
              {t("back")}
            </Button>
            {pending > 0 ? (
              <Button size="sm" className="h-9" disabled={busy} onClick={() => void resume()}>
                {busy ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                {t("resume")}
              </Button>
            ) : null}
          </div>
        }
      />

      <p className="text-[11px] text-muted-foreground">
        {t("detailMeta", {
          created: batch.created_count,
          failed: batch.failed_count,
          total: batch.total_count,
          status: t(`status.${batch.status}`),
        })}
      </p>

      <AppListCard className="p-0">
        <AppDataTable
          columns={[
            { id: "row", label: t("colRow") },
            { id: "emp", label: t("colEmployee") },
            { id: "status", label: t("colStatus") },
            { id: "req", label: t("colRequest") },
            { id: "err", label: t("colError") },
          ]}
        >
          {lines.map((line) => (
            <AppDataTableRow key={line.id}>
              <TableCell className="text-sm tabular-nums">{line.row_index + 1}</TableCell>
              <TableCell className="font-mono text-xs">{line.employee_id ?? "—"}</TableCell>
              <TableCell>
                <StatusPill variant={variant(line.status)}>{t(`rowStatus.${line.status}`)}</StatusPill>
              </TableCell>
              <TableCell>
                {line.request_id ? (
                  <Link
                    href={`/requests/esign/${line.request_id}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {line.request_code ?? t("viewDetails")}
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="max-w-[240px] truncate text-[11px] text-muted-foreground">
                {line.error ?? "—"}
              </TableCell>
            </AppDataTableRow>
          ))}
        </AppDataTable>
      </AppListCard>
    </AppPage>
  );
}
