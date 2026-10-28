"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Check,
  ChevronLeft,
  Download,
  MailCheck,
  FileSignature,
  Info,
  Loader2,
  RefreshCw,
  Trash2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage } from "@/components/app";
import { groupRows } from "@/components/app/app-list-controls";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import {
  TableNameCell,
  TableToolbar,
  useTablePrefs,
  type TableToolbarColumn,
} from "@/components/app/table-toolbar";
import { canResendEsign, esignResendHref } from "./esign-resend";
import { EsignDotKpis } from "./esign-kpi-strip";
import { esignDocumentHref } from "./esign-storage-key";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, usePathname } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  EsignRemindDialog,
  type EsignRemindTarget,
} from "./esign-remind-dialog";
import {
  esignBatchProgress,
  type EsignRecipientStage,
} from "./esign-recipient-stage";
import { processEsignBatchChunk, retryFailedEsignBatchRows } from "./esign-sender-actions";
import {
  ESIGN_RECIPIENT_TABS,
  formatEsignTrackerDate,
  recipientTab,
  recipientTabCounts,
  type EsignRecipientTab,
} from "./esign-tracker";
import type { EsignBatchLine, EsignTemplateFieldRow } from "./types";
import { useEsignBatch, useEsignTemplate, useRemoveEsignBatchRow, useUpdateEsignBatchRow } from "./use-esign";

const NO_TEMPLATE_FIELDS: EsignTemplateFieldRow[] = [];

type BatchColumnId = "name" | "emp" | "sent" | "status" | "signedOn" | "actions";

function isBatchColumnId(id: string): id is BatchColumnId {
  switch (id) {
    case "name":
    case "emp":
    case "sent":
    case "status":
    case "signedOn":
    case "actions":
      return true;
    default:
      return false;
  }
}

/**
 * Batch detail — reference panels D1, D3, D4, F3.
 *
 * The page draws two independent facts about the same row and never merges them:
 * the *row* result (`pending` / `created` / `failed` — did this uploaded row
 * produce a document) and the *recipient* stage (`signed` / `opened` /
 * `not_opened` / `declined`). Those are separate columns because a row can be
 * `created` and `not_opened` for a week, and collapsing them into one pill would
 * lose the distinction the whole tracker exists to draw.
 *
 * Every number on the progress bar comes from one roll-up
 * (`esignBatchProgress`) with the batch's own row count as the denominator, so
 * a batch where ten of forty rows failed to dispatch reads "4 of 40 signed"
 * rather than quietly shrinking its denominator to the thirty that worked.
 */
function esignDeskPaths(pathname: string) {
  const desk = pathname.includes("/employeedesk");
  return {
    desk,
    outgoingHref: desk ? "/employeedesk" : "/requests/esign",
    batchesHref: desk ? "/employeedesk/esign/batches" : "/requests/esign/batches",
  };
}

export function EsignBatchDetailShell({ batchId }: { batchId: string }) {
  const t = useTranslations("pages.requests.esign.batchDetail");
  const tBatches = useTranslations("pages.requests.esign.batches");
  const tTracker = useTranslations("pages.requests.esign.tracker");
  const tRcm = useTranslations("pages.rcmV2");
  const searchParams = useSearchParams();
  const sentRaw = searchParams.get("sent");
  const sentCount = sentRaw && /^\d+$/.test(sentRaw) ? Number(sentRaw) : 0;
  const pathname = usePathname();
  const paths = esignDeskPaths(pathname);
  const queryClient = useQueryClient();

  const removeMutation = useRemoveEsignBatchRow();

  const batchQuery = useEsignBatch(batchId);
  const batch = batchQuery.data?.batch ?? null;
  const lines = useMemo(() => batchQuery.data?.lines ?? [], [batchQuery.data?.lines]);
  const templateQuery = useEsignTemplate(batch?.template_id ?? "");
  const templateFields = templateQuery.data?.template?.fields ?? NO_TEMPLATE_FIELDS;

  const [tab, setTab] = useState<EsignRecipientTab>("all");
  const columns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "name", label: t("colName"), locked: true },
      { id: "emp", label: t("colEmployee"), locked: true },
      { id: "sent", label: tTracker("colSent") },
      { id: "status", label: t("colStage"), categorical: true },
      { id: "signedOn", label: t("colSignedOn") },
      { id: "actions", label: t("colActions") },
    ],
    [t, tTracker],
  );
  const prefs = useTablePrefs("esign-batch-detail", columns);
  const shownColumns = prefs.orderedColumns.filter((column) => prefs.isVisible(column.id));
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const [remindFocus, setRemindFocus] = useState<EsignRemindTarget[] | null>(null);
  const [fixRow, setFixRow] = useState<EsignBatchLine | null>(null);
  const [removeRow, setRemoveRow] = useState<EsignBatchLine | null>(null);
  const [declinedRow, setDeclinedRow] = useState<EsignBatchLine | null>(null);

  /**
   * The sheet columns a row can be corrected on.
   *
   * `Entry` is the only source that came from the uploaded sheet; `System`
   * reads the employee record, `Fixed` is template text and `Signature` is the
   * rider's own mark. Offering the other three for edit would be offering to
   * change something this dialog cannot save — the RPC writes the row's
   * `field_values` and re-resolves everything else from the template.
   */
  const sheetFields = useMemo(
    () => templateFields.filter((field) => field.source_kind === "entry"),
    [templateFields],
  );

  const dispatched = useMemo(() => lines.filter((line) => line.recipient_stage), [lines]);

  const progress = useMemo(
    () =>
      esignBatchProgress(
        dispatched.map((line) => ({
          status: line.recipient_status ?? "pending",
          viewed_at: line.recipient_viewed_at ?? null,
          stage: line.recipient_stage,
        })),
        lines.length,
      ),
    [dispatched, lines.length],
  );

  const waiting = progress.opened + progress.notOpened;
  const tabCounts = useMemo(
    () =>
      recipientTabCounts(
        dispatched.map((line) => ({
          status: line.recipient_status ?? "pending",
          viewed_at: line.recipient_viewed_at ?? null,
          stage: line.recipient_stage,
        })),
      ),
    [dispatched],
  );

  const visible = useMemo(() => {
    const query = prefs.appliedQuery.trim().toLowerCase();
    return lines.filter((line) => {
      if (tab !== "all" && (!line.recipient_stage || recipientTab(line.recipient_stage) !== tab)) {
        return false;
      }
      if (!query) return true;
      const haystack = `${line.employee_id ?? ""} ${line.signer_display_name ?? ""} ${lineStatusLabel(line, t)}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [lines, prefs.appliedQuery, t, tab]);
  const grouped = useMemo(
    () =>
      groupRows(
        visible,
        prefs.groupBy,
        { status: (line) => lineStatusLabel(line, t) },
        {},
        "—",
      ),
    [prefs.groupBy, t, visible],
  );

  const reminderTargets: EsignRemindTarget[] = useMemo(
    () =>
      lines
        .filter((line) => line.request_id && line.recipient_status)
        .map((line) => ({
          id: line.request_id as string,
          request_code: line.request_code ?? line.employee_id ?? `#${line.row_index + 1}`,
          status: line.recipient_status ?? "pending",
          viewed_at: line.recipient_viewed_at ?? null,
          label: line.signer_display_name ?? line.employee_id ?? undefined,
        })),
    [lines],
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.esign.all() });
  };

  /** Dispatch whatever the batch could not send, one locked chunk at a time. */
  async function resume() {
    setBusy(true);
    let remaining = 1;
    while (remaining > 0) {
      const chunk = await processEsignBatchChunk(batchId);
      if (!chunk.ok) {
        toast.error(chunk.error ?? tBatches("errors.processFailed"));
        break;
      }
      remaining = chunk.remaining;
      if (chunk.processed === 0) break;
    }
    setBusy(false);
    await refresh();
  }

  async function retryFailed() {
    setRetrying(true);
    const before = batch?.created_count ?? 0;
    const result = await retryFailedEsignBatchRows(batchId);
    setRetrying(false);
    await refresh();
    if (!result.ok) {
      toast.error(result.error ?? t("errors.loadFailed"));
      return;
    }
    if (result.created === 0 && result.failed === 0) {
      toast.info(t("retryNone"));
      return;
    }
    // `created` is the batch's recount after the pass, not this pass's delta, so
    // a retry that saved one row would otherwise report every row the batch
    // has ever sent.
    toast.success(
      t("retryDone", { created: Math.max(result.created - before, 0), failed: result.failed }),
    );
  }

  /**
   * The archive is fetched rather than linked.
   *
   * A plain anchor would navigate to the route's JSON body on a refusal
   * (`nothing_signed`, `too_many_documents`, `archive_too_large`), which turns a
   * batch with three signatures out of forty into a page reading
   * `{"error":"nothing_signed"}`.
   */
  async function downloadArchive() {
    if (!batch) return;
    setDownloading(true);
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
      anchor.download = `${batch.batch_code}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("errors.downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }

  if (batchQuery.isLoading) {
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
        <AppEmptyState
          title={t("errors.notFound")}
          description={batchQuery.data?.error ?? t("emptyRows")}
        />
      </AppPage>
    );
  }

  const pending = lines.filter((line) => line.status === "pending").length;
  // `TabBar` renders a plain label, so the count rides inside the string —
  // read off `recipientTabCounts`, the same roll-up the table filters by.
  const tabItems = ESIGN_RECIPIENT_TABS.map((id) => ({
    id,
    label: t(`recipientTabs.${id}`),
    count: tabCounts[id],
  }));
  const payslipDownload = /payslip/i.test(batch.template_name ?? "");

  const signedPct = progress.total ? (progress.signed / progress.total) * 100 : 0;
  const openedPct = progress.total ? (progress.opened / progress.total) * 100 : 0;
  const notOpenedPct = progress.total ? (progress.notOpened / progress.total) * 100 : 0;
  const declinedPct = progress.total ? (progress.declined / progress.total) * 100 : 0;

  return (
    <AppPage>
      <div className="space-y-3">
        <Link
          href={paths.batchesHref}
          className="inline-flex h-9 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5 rtl:rotate-180" />
          {t("backToSent")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-foreground">
              <FileSignature className="size-4" />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">{batch.title}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("headerMeta", {
                  date: formatEsignTrackerDate(batch.created_at),
                  count: progress.total,
                  template: batch.template_name ?? "—",
                })}
                {" · "}
                {t("signedTogether")}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {sentCount > 0 ? (
              <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white">
                <Check className="size-3.5" aria-hidden />
                {t("sentBanner", { count: sentCount })}
              </p>
            ) : null}
            <span className="shrink-0 rounded-md bg-[#FFFAEB] px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-[#B54708]">
              {tRcm("youSend")}
            </span>
          </div>
        </div>
        {pending > 0 || batch.failed_count > 0 ? (
        <div className="flex flex-wrap gap-2">
          {pending > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer"
              disabled={busy}
              onClick={() => void resume()}
            >
              {busy ? (
                <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <MailCheck className="me-1.5 h-3.5 w-3.5" />
              )}
              {t("resume")}
            </Button>
          ) : null}
          {batch.failed_count > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer"
              disabled={retrying}
              onClick={() => void retryFailed()}
            >
              {retrying ? (
                <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="me-1.5 h-3.5 w-3.5" />
              )}
              {t("retry")}
            </Button>
          ) : null}
        </div>
        ) : null}
      </div>

      <EsignDotKpis
        items={[
          {
            label: t("stageSigned"),
            value: progress.signed,
            dotClass: "bg-emerald-500",
          },
          {
            label: t("stageOpened"),
            value: progress.opened,
            dotClass: "bg-sky-500",
          },
          {
            label: t("stageNotOpened"),
            value: progress.notOpened,
            dotClass: "bg-zinc-400",
          },
          {
            label: t("stageDeclined"),
            value: progress.declined,
            dotClass: "bg-rose-500",
          },
        ]}
      />

      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {signedPct > 0 ? (
          <div className="h-full bg-emerald-500" style={{ width: `${signedPct}%` }} />
        ) : null}
        {openedPct > 0 ? (
          <div className="h-full bg-sky-500" style={{ width: `${openedPct}%` }} />
        ) : null}
        {notOpenedPct > 0 ? (
          <div className="h-full bg-zinc-300" style={{ width: `${notOpenedPct}%` }} />
        ) : null}
        {declinedPct > 0 ? (
          <div className="h-full bg-rose-500" style={{ width: `${declinedPct}%` }} />
        ) : null}
      </div>

      <AppListCard className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <div className="inline-flex w-fit flex-wrap gap-1 rounded-lg bg-muted/70 p-1">
            {tabItems.map((item) => {
              const active = item.id === tab;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
                    active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {item.label}
                  <span className="tabular-nums">{item.count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer"
              disabled={progress.signed === 0 || downloading}
              onClick={() => void downloadArchive()}
            >
              {downloading ? (
                <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="me-1.5 h-3.5 w-3.5" />
              )}
              {payslipDownload ? t("downloadAllPayslips") : t("downloadAll")}
            </Button>
            <Button
              size="sm"
              className="h-9 cursor-pointer bg-zinc-950 text-white hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-500 disabled:opacity-100"
              disabled={waiting === 0}
              onClick={() => {
                setRemindFocus(null);
                setRemindOpen(true);
              }}
            >
              {waiting === 0 ? t("noRemindable") : t("remindPending", { count: waiting })}
            </Button>
          </div>
        </div>

        <TableToolbar
          prefs={prefs}
          entity={t("colEmployee")}
          columns={columns}
          rowKind="dynamic"
          entityList={false}
          filteredCount={visible.length}
          totalCount={lines.length}
        />

        {lines.length === 0 ? (
          <AppEmptyState title={t("emptyRows")} description={t("emptyFiltered")} />
        ) : visible.length === 0 ? (
          <AppEmptyState title={t("emptyFiltered")} />
        ) : (
          <AppDataTable
            columns={shownColumns.map((column) => ({
              id: column.id,
              label: column.label,
              className: column.id === "actions" ? "text-end" : undefined,
            }))}
          >
            {grouped.flatMap((group) => [
              ...(prefs.groupBy !== "none"
                ? [
                    <AppDataTableRow key={`g-${group.key}`} className="hover:bg-transparent">
                      <TableCell colSpan={shownColumns.length} className="text-xs font-semibold">
                        {group.label} · {group.rows.length}
                      </TableCell>
                    </AppDataTableRow>,
                  ]
                : []),
              ...group.rows.map((line) => (
                <Row
                  key={line.id}
                  line={line}
                  sentAt={batch.created_at}
                  t={t}
                  shown={shownColumns}
                  onFix={() => setFixRow(line)}
                  onRemove={() => setRemoveRow(line)}
                  onDeclined={() => setDeclinedRow(line)}
                  onRemind={() => {
                    if (!line.request_id || !line.recipient_status) return;
                    setRemindFocus([
                      {
                        id: line.request_id,
                        request_code: line.request_code ?? line.employee_id ?? `#${line.row_index + 1}`,
                        status: line.recipient_status,
                        viewed_at: line.recipient_viewed_at ?? null,
                        label: line.signer_display_name ?? line.employee_id ?? undefined,
                      },
                    ]);
                    setRemindOpen(true);
                  }}
                />
              )),
            ])}
          </AppDataTable>
        )}
      </AppListCard>

      <p className="text-xs text-muted-foreground">{t("auditFooter")}</p>

      <FixRowDialog
        row={fixRow}
        onOpenChange={(open) => !open && setFixRow(null)}
        sheetFields={sheetFields}
        loadingFields={templateQuery.isLoading}
        onSaved={async () => {
          await refresh();
        }}
      />

      <SimpleConfirmDialog
        open={removeRow != null}
        onOpenChange={(open) => !open && setRemoveRow(null)}
        title={t("removeTitle")}
        description={t("removeConfirm", { row: (removeRow?.row_index ?? 0) + 1 })}
        confirmLabel={t("removeSubmit")}
        onConfirm={async () => {
          if (!removeRow) return;
          const result = await removeMutation.mutateAsync(removeRow.id);
          if (!result.ok) {
            toast.error(result.error ?? t("removeFailed"));
            return;
          }
          toast.success(t("removeDone"));
          setRemoveRow(null);
        }}
        isPending={removeMutation.isPending}
      />

      <EsignRemindDialog
        open={remindOpen}
        onOpenChange={(open) => {
          setRemindOpen(open);
          if (!open) setRemindFocus(null);
        }}
        recipients={remindFocus ?? reminderTargets}
        subtitle={batch.title}
      />

      <DeclinedReasonDialog
        row={declinedRow}
        documentLabel={batch.title}
        templateId={batch.template_id}
        onOpenChange={(open) => !open && setDeclinedRow(null)}
      />
    </AppPage>
  );
}

function kuwaitStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuwait",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function rowVariant(status: EsignBatchLine["status"]): "success" | "warning" | "danger" | "neutral" {
  if (status === "created") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

function lineStatusLabel(
  line: EsignBatchLine,
  t: ReturnType<typeof useTranslations>,
): string {
  if (line.recipient_stage) return stageWord(line.recipient_stage, t);
  return rowStatusWord(line.status, t);
}

function rowStatusWord(
  status: EsignBatchLine["status"],
  t: ReturnType<typeof useTranslations>,
): string {
  switch (status) {
    case "pending":
    case "created":
    case "failed":
      return t(`rowStage.${status}`);
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function cellClass(id: BatchColumnId): string | undefined {
  switch (id) {
    case "name":
      return "max-w-[180px] text-xs";
    case "emp":
      return "font-mono text-xs";
    case "sent":
    case "signedOn":
      return "text-xs tabular-nums text-muted-foreground";
    case "status":
      return undefined;
    case "actions":
      return "text-end";
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function Row({
  line,
  sentAt,
  t,
  shown,
  onFix,
  onRemove,
  onDeclined,
  onRemind,
}: {
  line: EsignBatchLine;
  sentAt: string;
  t: ReturnType<typeof useTranslations>;
  shown: TableToolbarColumn[];
  onFix: () => void;
  onRemove: () => void;
  onDeclined: () => void;
  onRemind: () => void;
}) {
  const stage: EsignRecipientStage | null = line.recipient_stage ?? null;

  function cellBody(id: BatchColumnId) {
    switch (id) {
      case "name":
        return <TableNameCell name={line.signer_display_name} />;
      case "emp":
        return line.employee_id ?? "—";
      case "sent":
        return formatEsignTrackerDate(sentAt);
      case "status":
        return stage ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium",
              stage === "signed"
                ? "text-emerald-700"
                : stage === "declined"
                  ? "text-rose-600"
                  : stage === "opened"
                    ? "text-sky-700"
                    : "text-muted-foreground",
            )}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {stageWord(stage, t)}
          </span>
        ) : (
          <StatusPill variant={rowVariant(line.status)}>
            {rowStatusWord(line.status, t)}
          </StatusPill>
        );
      case "signedOn":
        return line.recipient_signed_at ? formatEsignTrackerDate(line.recipient_signed_at) : "—";
      case "actions":
        return (
          <div className="flex items-center justify-end gap-1">
            {stage === "signed" && line.request_id ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 cursor-pointer px-2 text-xs font-medium"
                render={
                  <a href={esignDocumentHref(line.request_id, "signed", "attachment")} />
                }
              >
                <Download className="me-1 h-3.5 w-3.5" />
                {t("download")}
              </Button>
            ) : null}
            {stage === "opened" || stage === "not_opened" ? (
              <button
                type="button"
                className="cursor-pointer px-2 text-xs font-semibold text-[#F04438] disabled:opacity-40"
                onClick={onRemind}
                disabled={!line.request_id}
              >
                {t("remindAction")}
              </button>
            ) : null}
            {stage === "declined" ? (
              <button
                type="button"
                className="cursor-pointer px-2 text-xs font-semibold text-foreground"
                onClick={onDeclined}
              >
                {t("viewReason")}
              </button>
            ) : null}
            {line.status === "failed" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 cursor-pointer p-0 text-primary hover:bg-primary/10"
                      onClick={onFix}
                      aria-label={t("repairShort")}
                    >
                      <Wrench className="h-3.5 w-3.5" />
                    </Button>
                  }
                />
                <TooltipContent>{t("repair")}</TooltipContent>
              </Tooltip>
            ) : null}
            {line.status === "failed" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 cursor-pointer p-0 text-destructive hover:bg-destructive/10"
                      onClick={onRemove}
                      aria-label={t("removeShort")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  }
                />
                <TooltipContent>{t("remove")}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        );
      default: {
        const _exhaustive: never = id;
        return _exhaustive;
      }
    }
  }

  return (
    <AppDataTableRow>
      {shown.map((column) =>
        isBatchColumnId(column.id) ? (
          <TableCell key={column.id} className={cellClass(column.id)}>
            {cellBody(column.id)}
          </TableCell>
        ) : null,
      )}
    </AppDataTableRow>
  );
}

function stageWord(
  stage: EsignRecipientStage,
  t: ReturnType<typeof useTranslations>,
): string {
  switch (stage) {
    case "opened":
      return t("stageOpened");
    case "not_opened":
      return t("stageNotOpened");
    case "signed":
      return t("stageSigned");
    case "declined":
      return t("stageDeclined");
    case "expired":
      return t("stageExpired");
    case "cancelled":
      return t("stageCancelled");
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}

/**
 * Fix row — reference panel F3.
 *
 * Only the failed row's identity and its sheet columns are offered. The dialog
 * exists because a typed employee id was wrong or a sheet cell was unreadable,
 * so it opens on what the upload actually carried (`field_values`) rather than
 * on an empty form, and the server re-resolves the rest of the template from
 * the corrected employee id.
 */
function FixRowDialog({
  row,
  onOpenChange,
  sheetFields,
  loadingFields,
  onSaved,
}: {
  row: EsignBatchLine | null;
  onOpenChange: (open: boolean) => void;
  sheetFields: EsignTemplateFieldRow[];
  loadingFields: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations("pages.requests.esign.batchDetail");
  const update = useUpdateEsignBatchRow();
  const [employeeId, setEmployeeId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [rowKey, setRowKey] = useState<string | null>(null);

  // Reset on the *row identity*, not on every render: `field_values` is a fresh
  // object each fetch, so keying the reset on it would clear the operator's
  // typing the moment a background refetch landed.
  if (row && row.id !== rowKey) {
    setRowKey(row.id);
    setEmployeeId(row.employee_id ?? "");
    setValues(row.field_values ?? {});
  }

  async function submit() {
    if (!row) return;
    if (!employeeId.trim()) return;
    const result = await update.mutateAsync({
      row_id: row.id,
      employee_id: employeeId.trim(),
      field_values: values,
    });
    if (!result.ok) {
      toast.error(result.error ?? t("repairFailed"));
      return;
    }
    toast.success(t("repairSaved"));
    await onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={row != null}
      onOpenChange={(next) => {
        if (!update.isPending) onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex max-h-[min(92vh,760px)] w-[min(720px,96vw)] flex-col gap-0 overflow-visible rounded-xl p-0"
        showCloseButton={!update.isPending}
        closeOutside
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-4">
          <p className="text-xs text-muted-foreground">
            {t("repairSubtitle", { row: (row?.row_index ?? 0) + 1 })}
          </p>

          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="esign-repair-employee" className="text-xs font-semibold">
                {t("colEmployee")}
              </Label>
              <Input
                id="esign-repair-employee"
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                className="h-9 rounded-lg font-mono"
                autoComplete="off"
                disabled={update.isPending}
              />
            </div>

            {row?.error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-destructive">
                  <Info className="h-3 w-3" />
                  {t("rowError")}
                </p>
                <p className="mt-0.5 break-words text-xs text-destructive">{row.error}</p>
              </div>
            ) : null}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("rowSheetValues")}
              </p>
              {loadingFields ? (
                <div className="flex h-16 items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : sheetFields.length === 0 ? (
                <p className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-center text-xs text-muted-foreground">
                  {t("repairNoFields")}
                </p>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {sheetFields.map((field) => (
                    <div key={field.id} className="space-y-1">
                      <Label
                        htmlFor={`esign-repair-${field.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        {field.label_en || field.field_key}
                      </Label>
                      {field.field_type === "select" && field.options.length > 0 ? (
                        <select
                          id={`esign-repair-${field.id}`}
                          value={values[field.field_key] ?? ""}
                          onChange={(event) =>
                            setValues((prev) => ({
                              ...prev,
                              [field.field_key]: event.target.value,
                            }))
                          }
                          disabled={update.isPending}
                          className="h-9 w-full cursor-pointer rounded-lg border border-border bg-background px-2 text-xs"
                        >
                          <option value="">—</option>
                          {field.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          id={`esign-repair-${field.id}`}
                          value={values[field.field_key] ?? ""}
                          onChange={(event) =>
                            setValues((prev) => ({
                              ...prev,
                              [field.field_key]: event.target.value,
                            }))
                          }
                          className="h-9 rounded-lg text-xs"
                          autoComplete="off"
                          disabled={update.isPending}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <AppModalFooter title={t("repairTitle")} subtitle={t("repairSubtitle", { row: (row?.row_index ?? 0) + 1 })}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9 cursor-pointer rounded-md px-4"
            onClick={() => void submit()}
            disabled={update.isPending || employeeId.trim().length === 0}
          >
            {update.isPending ? (
              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wrench className="me-1.5 h-3.5 w-3.5" />
            )}
            {t("repairSubmit")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Declined reason — Figma O7. Header title + body + footer. */
function DeclinedReasonDialog({
  row,
  documentLabel,
  templateId,
  onOpenChange,
}: {
  row: EsignBatchLine | null;
  documentLabel?: string;
  templateId?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.requests.esign.batchDetail");
  const name = row?.signer_display_name ?? row?.employee_id ?? "—";
  const meta = t("declinedMeta", {
    id: row?.employee_id ?? "—",
    document: documentLabel ?? "—",
    when: kuwaitStamp(row?.recipient_declined_at),
  });

  return (
    <Dialog open={row != null} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(92vh,560px)] w-[min(560px,96vw)] flex-col gap-0 overflow-hidden rounded-xl p-0"
        showCloseButton
        closeOutside={false}
      >
        <DialogHeader className="border-b border-border px-5 py-4 pe-12">
          <DialogTitle className="text-base font-semibold">{t("declinedBy", { name })}</DialogTitle>
          <DialogDescription>{meta || t("declinedSubtitle")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("reasonGiven")}
          </p>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            {row?.declined_reason ? (
              <p className="whitespace-pre-wrap break-words text-sm">{row.declined_reason}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t("declinedEmpty")}</p>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 border-t border-border px-5 py-3 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            onClick={() => onOpenChange(false)}
          >
              {t("close")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            render={<Link href="/settings/logs?module=requests" />}
          >
            {t("viewAudit")}
          </Button>
          {row?.request_id && canResendEsign(row.recipient_status) ? (
            <Button
              type="button"
              size="sm"
              className="h-9 cursor-pointer rounded-md bg-zinc-950 text-white hover:bg-zinc-800"
              render={
                <Link
                  href={esignResendHref({
                    requestId: row.request_id,
                    driverId: row.driver_id,
                    templateId,
                  })}
                />
              }
            >
              {t("correctAndResend")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-9 rounded-md disabled:bg-zinc-200 disabled:text-zinc-500 disabled:opacity-100"
              disabled
            >
              {t("correctAndResend")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
