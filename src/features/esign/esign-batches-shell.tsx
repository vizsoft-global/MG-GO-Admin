"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  BellRing,
  Download,
  ExternalLink,
  FileSignature,
  Hourglass,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader, AppListToolbar } from "@/components/app";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { EsignKpiStrip } from "./esign-kpi-strip";
import { EsignRemindDialog, type EsignRemindTarget } from "./esign-remind-dialog";
import {
  ESIGN_TRACKER_TABS,
  batchStageKey,
  buildEsignTracker,
  filterTrackerBatches,
  formatEsignTrackerDate,
  trackerFilterOptions,
  trackerTabCounts,
  type EsignTrackerBatch,
  type EsignTrackerTab,
} from "./esign-tracker";
import { retryFailedEsignBatchRows } from "./esign-sender-actions";
import { useEsignBatchKpis, useEsignBatches, useEsignTrackerRecipients } from "./use-esign";
import type { EsignBatchStage } from "./esign-recipient-stage";
import type { EsignBatchRow, EsignTrackerRecipient } from "./types";

/**
 * Module-level empty fallbacks.
 *
 * `?? []` in the render body allocates a new array on every render, so every
 * memo that reads it re-fires — the shape that once looped this panel's Add
 * form into a React #185. A shared frozen constant keeps the identity stable
 * while the query is pending.
 */
const NO_BATCHES: EsignBatchRow[] = [];
const NO_RECIPIENTS: EsignTrackerRecipient[] = [];

/**
 * `Sent for signature` — reference panel D2.
 *
 * The screen answers one question, "who is still holding a document", and every
 * number on it is derived from the *recipients* rather than from the batch's own
 * dispatch status. That distinction is the reason this page exists separately
 * from `/requests/esign/batches`: a batch whose every row was emailed
 * successfully reads `completed` in `esign_batches.status` while nobody has
 * signed anything, and an operator who reads that as "done" stops chasing it.
 * `esignBatchStage` derives the real stage, and it is computed once per batch
 * here and read by the KPI tile, the tab, the progress cell and the filter —
 * four places that must never disagree.
 *
 * The four tiles come from `admin_esign_batch_kpis`, not a capped page
 * roll-up, so a 200-row list cannot under-count the fleet.
 */
export function EsignBatchesShell() {
  const t = useTranslations("pages.requests.esign.tracker");
  const tHub = useTranslations("pages.requests.esign.hub");
  const router = useRouter();
  const queryClient = useQueryClient();

  const batchesQuery = useEsignBatches();
  const recipientsQuery = useEsignTrackerRecipients();
  const kpisQuery = useEsignBatchKpis();

  const [tab, setTab] = useState<EsignTrackerTab>("all");
  const [search, setSearch] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [remindOpen, setRemindOpen] = useState(false);
  const [busyBatchId, setBusyBatchId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);

  // Module-level fallbacks, not `?? []`: a fresh array on every render is a new
  // identity for every memo that reads it, which is the `= []` shape that once
  // looped this panel's Add form to a React #185.
  const batches = batchesQuery.data?.rows ?? NO_BATCHES;
  const recipients = recipientsQuery.data?.recipients ?? NO_RECIPIENTS;

  const tracker = useMemo(
    () => buildEsignTracker(batches, recipients),
    [batches, recipients],
  );
  const kpis = kpisQuery.data?.kpis ?? {
    batchesSent: 0,
    waitingSignatures: 0,
    fullySigned: 0,
    declined: 0,
  };
  const tabCounts = useMemo(() => trackerTabCounts(tracker), [tracker]);
  const options = useMemo(() => trackerFilterOptions(tracker), [tracker]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return filterTrackerBatches(tracker, tab).filter((row) => {
      if (templateId && row.batch.template_id !== templateId) return false;
      if (!needle) return true;
      return (
        row.batch.batch_code.toLowerCase().includes(needle) ||
        row.batch.title.toLowerCase().includes(needle) ||
        (row.batch.template_name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [tracker, tab, templateId, search]);

  /**
   * Every outstanding rider across the batches currently on screen.
   *
   * Deliberately built from `visible`, not from `tracker`: the drawer chases
   * "what I am looking at", and a reminder that reached riders the operator had
   * filtered away would make the count on the button a number they cannot
   * account for. The drawer filters to the two waiting stages itself, so this
   * passes every stage through rather than duplicating that rule.
   */
  const reminderTargets: EsignRemindTarget[] = useMemo(
    () =>
      visible.map((row) => row.batch.id).flatMap((batchId) =>
        recipients
          .filter((r) => r.batch_id === batchId)
          .map((r) => ({
            id: r.id,
            request_code: r.request_code,
            status: r.status,
            viewed_at: r.viewed_at,
          })),
      ),
    [visible, recipients],
  );

  const waitingCount = useMemo(
    () =>
      visible.reduce(
        (total, row) => total + row.progress.opened + row.progress.notOpened,
        0,
      ),
    [visible],
  );

  const failedBatches = useMemo(
    () => visible.filter((row) => row.batch.failed_count > 0),
    [visible],
  );

  async function retryAll() {
    setRetryingAll(true);
    let sent = 0;
    let failed = 0;
    let refused = 0;
    // Sequential, not `Promise.all`: each call claims rows under a lock and
    // renders PDFs in a headless browser, so fifteen concurrent retries would
    // fight over the same machine for no wall-clock win.
    for (const row of failedBatches) {
      const result = await retryFailedEsignBatchRows(row.batch.id);
      if (!result.ok) {
        refused += 1;
        continue;
      }
      // `created` and `failed` come back as the batch's *recounted* totals,
      // not as this pass's deltas, so the tile has to subtract what the batch
      // already had or a retry that saved one row would report all thirty.
      sent += Math.max(result.created - row.batch.created_count, 0);
      failed += result.failed;
    }
    setRetryingAll(false);
    await queryClient.invalidateQueries({ queryKey: queryKeys.esign.all() });
    if (refused > 0) {
      toast.error(t("errors.retryFailed"));
      return;
    }
    if (sent === 0 && failed === 0) {
      toast.info(t("retryNone"));
      return;
    }
    toast.success(t("retryDone", { created: sent, failed }));
  }

  async function retryOne(row: EsignTrackerBatch) {
    setBusyBatchId(row.batch.id);
    const result = await retryFailedEsignBatchRows(row.batch.id);
    setBusyBatchId(null);
    await queryClient.invalidateQueries({ queryKey: queryKeys.esign.all() });
    if (!result.ok) {
      toast.error(result.error ?? t("errors.retryFailed"));
      return;
    }
    if (result.created === 0 && result.failed === 0) {
      toast.info(t("retryNone"));
      return;
    }
    // The same recount-vs-delta distinction as `retryAll`: `created` is the
    // batch's total after the pass, so the delta is what this retry saved.
    toast.success(
      t("retryDone", {
        created: Math.max(result.created - row.batch.created_count, 0),
        failed: result.failed,
      }),
    );
  }

  /**
   * The archive is fetched rather than linked.
   *
   * A plain `<a href>` would navigate the operator to the route's JSON body on
   * a refusal (`nothing_signed`, `too_many_documents`, `archive_too_large`), so
   * a batch where only three of forty rows are signed would replace the page
   * with `{"error":"nothing_signed"}`. Reading the status lets each refusal say
   * which of the three it is, and the object URL carries the filename where a
   * direct navigation would have to trust `Content-Disposition` alone.
   */
  async function downloadArchive(batchId: string, batchCode: string) {
    setDownloadingId(batchId);
    try {
      const response = await fetch(`/api/esign/batch-zip?id=${encodeURIComponent(batchId)}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error(
          body?.error === "nothing_signed" ? t("downloadNone") : t("errors.downloadFailed"),
        );
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${batchCode}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("errors.downloadFailed"));
    } finally {
      setDownloadingId(null);
    }
  }

  const loading = batchesQuery.isLoading || recipientsQuery.isLoading;
  const error = batchesQuery.data?.error ?? recipientsQuery.data?.error;

  // `TabBar` renders a plain label, so the count rides inside the string. It is
  // read from `trackerTabCounts`, the same roll-up the tiles and the filter use.
  const tabItems = ESIGN_TRACKER_TABS.map((id) => ({
    id,
    label: `${t(`tabs.${tabKey(id)}`)} (${tabCounts[id]})`,
  }));

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
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer"
              render={<Link href="/requests/esign/batches" />}
            >
              {t("colBatch")}
            </Button>
            <Button
              size="sm"
              className="h-9 cursor-pointer"
              disabled={waitingCount === 0}
              onClick={() => setRemindOpen(true)}
            >
              <BellRing className="me-1.5 h-3.5 w-3.5" />
              {waitingCount === 0 ? t("remindNone") : t("remind")}
            </Button>
          </div>
        }
      />

      <EsignKpiStrip
        items={[
          {
            label: t("kpiBatches30d"),
            value: kpis.batchesSent,
            icon: FileSignature,
            accent: "primary",
          },
          {
            label: t("kpiWaiting"),
            value: kpis.waitingSignatures,
            icon: Hourglass,
            accent: "warning",
          },
          {
            label: t("kpiSigned"),
            value: kpis.fullySigned,
            icon: FileSignature,
            accent: "success",
          },
          {
            label: t("kpiDeclined"),
            value: kpis.declined,
            icon: TriangleAlert,
            accent: "danger",
          },
        ]}
      />

      <AppListCard className="p-0">
        <div className="flex flex-col gap-3 border-b border-border p-3">
          <TabBar items={tabItems} activeId={tab} onSelect={(id) => setTab(id as EsignTrackerTab)} />
          <AppListToolbar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={t("searchPlaceholder")}
            countLabel={`${visible.length} / ${tracker.length}`}
            filterSlot={
              options.templates.length > 0 ? (
                <select
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                  className="h-9 w-full cursor-pointer rounded-lg border border-border bg-background px-2 text-xs sm:w-56"
                  aria-label={t("colTemplate")}
                >
                  <option value="">{t("templateAll")}</option>
                  {options.templates.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              ) : null
            }
            trailing={
              failedBatches.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 cursor-pointer"
                  disabled={retryingAll}
                  onClick={() => void retryAll()}
                >
                  {retryingAll ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                  )}
                  {retryingAll ? t("retrying") : t("retry")}
                </Button>
              ) : null
            }
          />
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <AppEmptyState title={t("emptyTitle")} description={error} />
        ) : visible.length === 0 ? (
          <AppEmptyState
            title={tracker.length === 0 ? t("emptyTitle") : t("emptyFiltered")}
            description={tracker.length === 0 ? t("emptyDescription") : t("clearFilters")}
          />
        ) : (
          <AppDataTable
            columns={[
              { id: "batch", label: t("colBatch") },
              { id: "template", label: t("colTemplate") },
              { id: "progress", label: t("colProgress") },
              { id: "status", label: t("colStatus") },
              { id: "sent", label: t("colSent") },
              { id: "actions", label: t("colActions"), className: "text-end" },
            ]}
          >
            {visible.map((row) => (
              <BatchRow
                key={row.batch.id}
                row={row}
                t={t}
                busy={busyBatchId === row.batch.id}
                downloading={downloadingId === row.batch.id}
                onOpen={() => router.push(`/requests/esign/batches/${row.batch.id}`)}
                onRetry={() => void retryOne(row)}
                onDownload={() => void downloadArchive(row.batch.id, row.batch.batch_code)}
              />
            ))}
          </AppDataTable>
        )}
      </AppListCard>

      <EsignRemindDialog
        open={remindOpen}
        onOpenChange={setRemindOpen}
        recipients={reminderTargets}
      />
    </AppPage>
  );
}

/** `TabBar` ids are the stage keys; only the two multi-word labels differ. */
function tabKey(id: EsignTrackerTab): string {
  if (id === "in_progress") return "inProgress";
  if (id === "has_declines") return "hasDeclines";
  return id;
}

function batchVariant(stage: EsignBatchStage): "success" | "warning" | "danger" | "neutral" {
  if (stage === "completed") return "success";
  if (stage === "has_declines") return "danger";
  if (stage === "in_progress") return "warning";
  return "neutral";
}

function BatchRow({
  row,
  t,
  busy,
  downloading,
  onOpen,
  onRetry,
  onDownload,
}: {
  row: EsignTrackerBatch;
  t: ReturnType<typeof useTranslations>;
  busy: boolean;
  downloading: boolean;
  onOpen: () => void;
  onRetry: () => void;
  onDownload: () => void;
}) {
  const { batch, progress, stage } = row;
  const waiting = progress.opened + progress.notOpened;

  return (
    <AppDataTableRow onClick={onOpen}>
      <TableCell>
        <span className="font-mono text-xs font-semibold">{batch.batch_code}</span>
        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
          {batch.title}
          <ExternalLink className="h-3 w-3" />
        </span>
      </TableCell>
      <TableCell className="text-xs">{batch.template_name ?? "—"}</TableCell>
      <TableCell>
        <div className="flex min-w-[140px] flex-col gap-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {t("progressLabel", { signed: progress.signed, total: progress.total })}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {t("progressHint", { waiting, declined: progress.declined })}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <StatusPill variant={batchVariant(stage)}>
          {t(`batchStatus.${batchStageKey(stage)}`)}
        </StatusPill>
      </TableCell>
      <TableCell className="text-xs tabular-nums text-muted-foreground">
        {formatEsignTrackerDate(batch.created_at)}
      </TableCell>
      <TableCell className="text-end">
        <div
          className="flex items-center justify-end gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 cursor-pointer p-0"
                  disabled={batch.failed_count === 0 || busy}
                  onClick={onRetry}
                  aria-label={t("retryShort")}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </Button>
              }
            />
            <TooltipContent>
              {batch.failed_count === 0
                ? t("retryNone")
                : `${t("retry")} · ${batch.failed_count}`}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 cursor-pointer p-0 text-primary hover:bg-primary/10"
                  disabled={progress.signed === 0 || downloading}
                  onClick={onDownload}
                  aria-label={t("downloadShort")}
                >
                  {downloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                </Button>
              }
            />
            <TooltipContent>
              {progress.signed === 0 ? t("downloadNone") : t("download")}
            </TooltipContent>
          </Tooltip>
        </div>
      </TableCell>
    </AppDataTableRow>
  );
}
