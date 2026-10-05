"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  BellRing,
  Download,
  ExternalLink,
  Info,
  Loader2,
  MailCheck,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { AppEmptyState, AppListCard, AppPage, AppPageHeader } from "@/components/app";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import {
  AppDataTable,
  AppDataTableRow,
  TableCell,
} from "@/components/app/app-data-table";
import { SimpleConfirmDialog } from "@/components/simple-confirm-dialog";
import { StatusPill } from "@/components/dashboard/status-pill";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";
import {
  EsignRemindDialog,
  type EsignRemindTarget,
} from "./esign-remind-dialog";
import {
  esignBatchProgress,
  esignBatchStage,
  type EsignBatchStage,
  type EsignRecipientStage,
} from "./esign-recipient-stage";
import { processEsignBatchChunk, retryFailedEsignBatchRows } from "./esign-sender-actions";
import {
  ESIGN_RECIPIENT_TABS,
  batchStageKey,
  formatEsignTrackerDate,
  recipientStatusKey,
  recipientTab,
  recipientTabCounts,
  type EsignRecipientTab,
} from "./esign-tracker";
import type { EsignTemplateFieldRow } from "./types";
import { useEsignBatch, useEsignTemplate, useRemoveEsignBatchRow, useUpdateEsignBatchRow } from "./use-esign";
import type { EsignBatchLine } from "./types";

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
export function EsignBatchDetailShell({ batchId }: { batchId: string }) {
  const t = useTranslations("pages.requests.esign.batchDetail");
  const tBatches = useTranslations("pages.requests.esign.batches");
  const tTracker = useTranslations("pages.requests.esign.tracker");
  const tHub = useTranslations("pages.requests.esign.hub");
  const queryClient = useQueryClient();

  const removeMutation = useRemoveEsignBatchRow();

  const batchQuery = useEsignBatch(batchId);
  const batch = batchQuery.data?.batch ?? null;
  const lines = useMemo(() => batchQuery.data?.lines ?? [], [batchQuery.data?.lines]);
  const templateQuery = useEsignTemplate(batch?.template_id ?? "");
  const templateFields = templateQuery.data?.template?.fields ?? [];

  const [tab, setTab] = useState<EsignRecipientTab>("all");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
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

  const stage = esignBatchStage(progress);
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
    if (tab === "all") return lines;
    return lines.filter((line) => line.recipient_stage && recipientTab(line.recipient_stage) === tab);
  }, [lines, tab]);

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
    label: `${t(`recipientTabs.${id}`)} (${tabCounts[id]})`,
  }));

  return (
    <AppPage>
      <AppPageHeader
        title={batch.batch_code}
        description={batch.title}
        breadcrumbs={[
          { label: tHub("requests"), href: "/requests" },
          { label: tHub("title"), href: "/requests/esign" },
          { label: tBatches("title"), href: "/requests/esign/batches" },
          { label: batch.batch_code },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer"
              render={<Link href="/requests/esign/batches" />}
            >
              {t("back")}
            </Button>
            {pending > 0 ? (
              <Button
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
            <Button
              variant="outline"
              size="sm"
              className="h-9 cursor-pointer"
              disabled={waiting === 0}
              onClick={() => setRemindOpen(true)}
            >
              <BellRing className="me-1.5 h-3.5 w-3.5" />
              {waiting === 0 ? t("noRemindable") : t("remindTitle")}
            </Button>
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
              {t("download")}
            </Button>
          </div>
        }
      />

      <AppListCard className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span className="text-xs font-medium tabular-nums">
              {t("progressLabel", { signed: progress.signed, total: progress.total })}
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {t("progressHint", {
                waiting: progress.opened + progress.notOpened,
                declined: progress.declined,
                failed: batch.failed_count,
              })}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusPill variant={stageVariant(stage)}>
              {tTracker(`batchStatus.${batchStageKey(stage)}`)}
            </StatusPill>
            <span className="text-[11px] text-muted-foreground">
              {t("meta", {
                created: batch.created_count,
                failed: batch.failed_count,
                total: batch.total_count,
                status: tBatches(`status.${batch.status}`),
              })}
            </span>
          </div>
        </div>
      </AppListCard>

      <AppListCard className="p-0">
        <div className="border-b border-border p-3">
          <TabBar
            items={tabItems}
            activeId={tab}
            onSelect={(id) => setTab(id as EsignRecipientTab)}
          />
        </div>

        {lines.length === 0 ? (
          <AppEmptyState title={t("emptyRows")} description={t("emptyFiltered")} />
        ) : visible.length === 0 ? (
          <AppEmptyState title={t("emptyFiltered")} />
        ) : (
          <AppDataTable
            columns={[
              { id: "row", label: t("colRow") },
              { id: "emp", label: t("colEmployee") },
              { id: "name", label: t("colName") },
              { id: "stage", label: t("colStage") },
              { id: "due", label: t("colDue") },
              { id: "rem", label: t("colReminded") },
              { id: "req", label: t("colRequest") },
              { id: "actions", label: t("colActions"), className: "text-end" },
            ]}
          >
            {visible.map((line) => (
              <Row
                key={line.id}
                line={line}
                t={t}
                onFix={() => setFixRow(line)}
                onRemove={() => setRemoveRow(line)}
                onDeclined={() => setDeclinedRow(line)}
              />
            ))}
          </AppDataTable>
        )}
      </AppListCard>

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
        onOpenChange={setRemindOpen}
        recipients={reminderTargets}
      />

      <DeclinedReasonDialog
        row={declinedRow}
        onOpenChange={(open) => !open && setDeclinedRow(null)}
      />
    </AppPage>
  );
}

function stageVariant(stage: EsignBatchStage): "success" | "warning" | "danger" | "neutral" {
  if (stage === "completed") return "success";
  if (stage === "has_declines") return "danger";
  if (stage === "in_progress") return "warning";
  return "neutral";
}

function rowVariant(status: EsignBatchLine["status"]): "success" | "warning" | "danger" | "neutral" {
  if (status === "created") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

function Row({
  line,
  t,
  onFix,
  onRemove,
  onDeclined,
}: {
  line: EsignBatchLine;
  t: ReturnType<typeof useTranslations>;
  onFix: () => void;
  onRemove: () => void;
  onDeclined: () => void;
}) {
  const stage: EsignRecipientStage | null = line.recipient_stage ?? null;

  return (
    <AppDataTableRow>
      <TableCell className="text-xs tabular-nums text-muted-foreground">
        {line.row_index + 1}
      </TableCell>
      <TableCell className="font-mono text-xs">{line.employee_id ?? "—"}</TableCell>
      <TableCell className="max-w-[180px] truncate text-xs">
        {line.signer_display_name ?? "—"}
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <StatusPill variant={rowVariant(line.status)}>
            {t(`rowStage.${line.status}`, { defaultValue: line.status })}
          </StatusPill>
          {stage ? (
            <span
              className={cn(
                "text-[10px] font-medium",
                stage === "signed"
                  ? "text-emerald-700"
                  : stage === "declined"
                    ? "text-destructive"
                    : "text-muted-foreground",
              )}
            >
              {t(recipientStatusKey(stage))}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-[11px] tabular-nums text-muted-foreground">
        {line.recipient_due_at ? formatEsignTrackerDate(line.recipient_due_at) : "—"}
      </TableCell>
      <TableCell className="text-[11px] tabular-nums text-muted-foreground">
        {line.last_reminded_at
          ? `${formatEsignTrackerDate(line.last_reminded_at)}${
              line.reminder_count ? ` · ${line.reminder_count}×` : ""
            }`
          : t("never")}
      </TableCell>
      <TableCell>
        {line.request_id ? (
          <Link
            href={`/requests/esign/${line.request_id}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {line.request_code ?? t("viewRequest")}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-end">
        <div className="flex items-center justify-end gap-1">
          {stage === "declined" ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 cursor-pointer p-0 text-destructive hover:bg-destructive/10"
                    onClick={onDeclined}
                    aria-label={t("declinedTitle")}
                  >
                    <TriangleAlert className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              <TooltipContent>{t("declinedTitle")}</TooltipContent>
            </Tooltip>
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
          {line.status !== "created" ? (
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
      </TableCell>
    </AppDataTableRow>
  );
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
          <p className="text-[11px] text-muted-foreground">
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
                <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-destructive">
                  <Info className="h-3 w-3" />
                  {t("rowError")}
                </p>
                <p className="mt-0.5 break-words text-xs text-destructive">{row.error}</p>
              </div>
            ) : null}

            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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
                        className="text-[11px] text-muted-foreground"
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

/** Declined reason — reference panel D4, read-only. */
function DeclinedReasonDialog({
  row,
  onOpenChange,
}: {
  row: EsignBatchLine | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.requests.esign.batchDetail");

  return (
    <Dialog open={row != null} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(92vh,560px)] w-[min(560px,96vw)] flex-col gap-0 overflow-visible rounded-xl p-0"
        closeOutside
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-4">
          <p className="text-[11px] text-muted-foreground">{t("declinedSubtitle")}</p>
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            {row?.declined_reason ? (
              <p className="whitespace-pre-wrap break-words text-sm">{row.declined_reason}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t("declinedEmpty")}</p>
            )}
          </div>
          {row?.signer_display_name || row?.employee_id ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {row?.signer_display_name ?? "—"}
              {row?.employee_id ? <span className="ms-1.5 font-mono">{row.employee_id}</span> : null}
            </p>
          ) : null}
        </div>

        <AppModalFooter title={t("declinedTitle")} subtitle={t("declinedSubtitle")}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
