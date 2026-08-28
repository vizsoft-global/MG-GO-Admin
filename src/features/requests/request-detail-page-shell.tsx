"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  Check,
  Download,
  FileUp,
  Loader2,
  MessageCircleQuestion,
  Paperclip,
  Pencil,
  Send,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { AppPage, AppPageHeader } from "@/components/app";
import { StatusPill } from "@/components/dashboard/status-pill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { fetchRequestAttachmentUrl } from "./requests-actions";
import { RequestApprovalTimeline } from "./request-approval-timeline";
import { RequestDecisionTermsDialog } from "./request-decision-terms-dialog";
import { RequestFieldRow } from "./request-field-row";
import { RequestFuelTransferCard } from "./request-fuel-transfer-card";
import { RequestRescheduleDialog } from "./request-reschedule-dialog";
import { RequestTypedDrawer } from "./request-typed-drawer";
import {
  formatFieldValue,
  getExtraPayloadRows,
  getTypedFieldRows,
} from "./request-typed-fields";
import {
  canCloseRequest,
  isAwaitingRescheduleReply,
  isDriverAcknowledged,
  requestStatusLabelKey,
  requestStatusVariant,
} from "./request-status-utils";
import { fuelFinalApproveBlocked } from "./request-create-utils";
import { RequesterHeader } from "./requester-header";
import { DECISION_TERM_TYPES } from "./types";
import type {
  RequestApprovalStep,
  RequestDecisionTerms,
  RequestRescheduleInput,
} from "./types";
import {
  useAdminRequestDetail,
  useDecideRequest,
  useSaveDecisionTerms,
} from "./use-requests";

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Each template action reads as its own outcome — a shared check mark would imply approval. */
const ACTION_ICONS: Record<string, LucideIcon> = {
  approve: Check,
  reschedule: CalendarClock,
  request_documents: FileUp,
  send_response: Send,
  escalate: ArrowUpRight,
  attach_send: Paperclip,
  attach_breakdown: Paperclip,
};

function currentStepAllowedActions(steps: RequestApprovalStep[]): string[] {
  const active = steps.find((s) => s.status === "in_progress");
  return active?.allowed_actions ?? [];
}

/**
 * Terms only reach the driver when they sit on the step that closes the
 * request, because the app reads the last completed step's meta.
 */
function isFinalApprovalStep(steps: RequestApprovalStep[]): boolean {
  const active = steps.find((s) => s.status === "in_progress");
  if (!active) return true;
  return !steps.some((s) => s.step_order > active.step_order && s.status === "pending");
}

function decidedTerms(steps: RequestApprovalStep[]): RequestDecisionTerms | null {
  const completed = steps
    .filter((s) => s.status === "completed")
    .sort((a, b) => b.step_order - a.step_order)[0];
  const meta = completed?.meta;
  if (!meta) return null;
  const number = (value: unknown) => (value != null ? Number(value) : null);
  return {
    approved_amount: number(meta.approved_amount),
    approved_tenure_months: number(meta.approved_tenure_months),
    deduction_start_date: meta.deduction_start_date != null ? String(meta.deduction_start_date) : null,
    penalty_amount: number(meta.penalty_amount),
    required_document: meta.required_document != null ? String(meta.required_document) : null,
  };
}

function termRowsFor(
  requestType: string,
  terms: RequestDecisionTerms | null,
): { key: string; value: string | null }[] {
  const kwd = (value: number | null | undefined) =>
    value != null ? `${value.toFixed(3)} KWD` : null;
  if (requestType === "loan") {
    return [
      { key: "approvedAmount", value: kwd(terms?.approved_amount) },
      {
        key: "tenureMonths",
        value: terms?.approved_tenure_months != null ? String(terms.approved_tenure_months) : null,
      },
      {
        key: "deductionStart",
        value: terms?.deduction_start_date ? formatFieldValue(terms.deduction_start_date) : null,
      },
    ];
  }
  if (requestType === "asset") {
    return [{ key: "penaltyAmount", value: kwd(terms?.penalty_amount) }];
  }
  return [{ key: "requiredDocument", value: terms?.required_document ?? null }];
}

export function RequestDetailPageShell({ requestId }: { requestId: string }) {
  const t = useTranslations("pages.requests");
  const { can } = useAuth();
  const canDecide = can("requests.approve") || can("requests.manage");
  const { data, isLoading, refetch } = useAdminRequestDetail(requestId);
  const decide = useDecideRequest(requestId);
  const saveTerms = useSaveDecisionTerms(requestId);
  const [reason, setReason] = useState("");
  const [termsMode, setTermsMode] = useState<"approve" | "edit" | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const request = data?.request;
  const steps = data?.steps ?? [];
  const clarifications = data?.clarifications ?? [];
  const attachments = data?.attachments ?? [];
  const rows = request ? getTypedFieldRows(request) : [];
  const subjectRow = rows.find((row) => row.key === "subject" && row.value !== "—");
  const detailRows = rows.filter((row) => row.key !== "subject" && row.key !== "description");
  const allDetailRows = request
    ? [...detailRows, ...getExtraPayloadRows(request)]
    : detailRows;
  const descriptionRow = rows.find((row) => row.key === "description");
  const message =
    descriptionRow && descriptionRow.value !== "—" ? descriptionRow.value : request?.details;
  const decided = request?.completed_at != null;
  const awaitingRider =
    request != null && isAwaitingRescheduleReply(request.status, request.payload);
  const stepActions = currentStepAllowedActions(steps);
  const REASON_REQUIRED_ACTIONS = new Set(["reject", "clarify", "send_response"]);
  const canClose =
    request != null && canDecide && canCloseRequest(request.status, request.completed_at);
  const takesTerms =
    request != null &&
    (DECISION_TERM_TYPES as readonly string[]).includes(request.request_type);
  const currentTerms = decidedTerms(steps);
  const acknowledged = request != null && isDriverAcknowledged(request.status, request.payload);
  const termsOnApprove = takesTerms && isFinalApprovalStep(steps);
  const fuelApproveBlocked =
    request != null &&
    fuelFinalApproveBlocked({
      requestType: request.request_type,
      fuelTransferType: request.fuel_transfer_type,
      isFinalStep: isFinalApprovalStep(steps),
    });
  const ackNote =
    typeof request?.payload?.driver_ack_note === "string"
      ? request.payload.driver_ack_note.trim()
      : "";

  const runAction = async (
    action: string,
    options?: {
      terms?: RequestDecisionTerms;
      reschedule?: RequestRescheduleInput;
      reasonOverride?: string;
    },
  ) => {
    const note = (options?.reasonOverride ?? reason).trim();
    if (action === "approve" && fuelApproveBlocked) {
      toast.error(t("detail.fuelTransfer.requiredBeforeApprove"));
      return;
    }
    if (REASON_REQUIRED_ACTIONS.has(action) && !note) {
      toast.error(t("detail.reasonRequired"));
      return;
    }
    const result = await decide.mutateAsync({
      action,
      reason: note || undefined,
      terms: options?.terms,
      reschedule: options?.reschedule,
    });
    if (!result.ok) {
      toast.error(
        result.error === "fuel_transfer_type_required"
          ? t("detail.fuelTransfer.requiredBeforeApprove")
          : (result.error ?? t("detail.actionFailed")),
      );
      return;
    }
    toast.success(t("detail.actionOk"));
    setReason("");
    setTermsMode(null);
    setRescheduleOpen(false);
    await refetch();
  };

  const submitTermsEdit = async (terms: RequestDecisionTerms) => {
    const result = await saveTerms.mutateAsync(terms);
    if (!result.ok) {
      toast.error(result.error ?? t("detail.actionFailed"));
      return;
    }
    toast.success(t("detail.terms.saved"));
    setTermsMode(null);
    await refetch();
  };

  const openAttachment = async (storageKey: string) => {
    const result = await fetchRequestAttachmentUrl(storageKey);
    if (!result.url) {
      toast.error(result.error ?? t("detail.actionFailed"));
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  if (isLoading) {
    return (
      <AppPage>
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppPage>
    );
  }

  if (!request) {
    return (
      <AppPage>
        <AppPageHeader title={t("detail.notFound")} />
        <Button variant="outline" className="h-9" render={<Link href="/requests/overview" />}>
          <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
          {t("detail.back")}
        </Button>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <AppPageHeader
        title={request.request_code}
        description={`${t(`types.${request.request_type}` as "types.leave")} · ${request.current_step_label ?? "—"}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill dot variant={requestStatusVariant(request.status, request.payload)}>
              {t(`status.${requestStatusLabelKey(request.status, request.payload)}` as "status.pending")}
            </StatusPill>
            <RequestTypedDrawer request={request} steps={steps} attachments={attachments} />
            <Button variant="outline" size="sm" className="h-9" render={<Link href="/requests/overview" />}>
              <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
              {t("detail.back")}
            </Button>
          </div>
        }
      />

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <RequesterHeader
          driverId={request.driver_id}
          requestId={request.id}
          requester={request.requester}
        />
      </div>

      <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
        <section className="h-full rounded-xl border border-border bg-card p-4 shadow-sm">
          {subjectRow || request.details ? (
            <div className="mb-3 space-y-1.5">
              {subjectRow ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("detail.subject")}
                  </p>
                  <p className="text-sm font-semibold">{subjectRow.value}</p>
                </div>
              ) : null}
              {message ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("detail.message")}
                  </p>
                  <p className="text-sm whitespace-pre-wrap text-foreground/90">{message}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <h2 className="mb-2 text-sm font-semibold">{t("detail.fields")}</h2>
          {allDetailRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("detail.noTypedFields")}</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border text-sm">
              {allDetailRows.map((row) => (
                <RequestFieldRow
                  key={row.key}
                  label={row.label}
                  muted={row.value === "—" && !row.gatedKey}
                >
                  {row.gatedKey ? (
                    <span className="text-[11px] font-normal text-warning">
                      {t(`detail.${row.gatedKey}` as "detail.categoryGated")}
                    </span>
                  ) : (
                    row.value
                  )}
                </RequestFieldRow>
              ))}
            </div>
          )}

          <div className="mt-3 border-t border-border pt-3">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Paperclip className="h-3.5 w-3.5" />
              {t("detail.attachments")}
            </h3>
            {attachments.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">{t("detail.noAttachments")}</p>
            ) : (
              <ul className="space-y-1">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => void openAttachment(a.storage_key)}
                      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {a.file_name ?? a.storage_key.split("/").pop()}
                      {a.byte_size != null ? (
                        <span className="text-[11px] text-muted-foreground">
                          {formatFileSize(a.byte_size)}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="flex h-full flex-col gap-2">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">{t("detail.approval")}</h2>
            <RequestApprovalTimeline steps={steps} />

            {clarifications.length > 0 ? (
              <div className="mt-3 space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground">
                  {t("detail.clarifications")}
                </h3>
                {clarifications.map((c) => (
                  <div key={c.id} className="rounded-lg border border-border p-2 text-xs">
                    <p className="font-medium">{c.question}</p>
                    {c.answer ? (
                      <p className="mt-1 text-muted-foreground">{c.answer}</p>
                    ) : (
                      <p className="mt-1 text-warning">{t("detail.awaitingAnswer")}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

        {awaitingRider ? (
          <section className="rounded-xl border border-warning/30 bg-warning-bg p-4">
            <p className="flex items-center gap-1.5 text-xs text-warning">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              {t("detail.reschedule.awaitingRider")}
            </p>
          </section>
        ) : null}

        {request.request_type === "fuel" ? (
          <RequestFuelTransferCard
            requestId={request.id}
            value={request.fuel_transfer_type}
            editable={canDecide && request.status !== "closed"}
          />
        ) : null}

        {canDecide && !decided && !awaitingRider ? (
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">{t("detail.actions")}</h2>
            <Textarea
              className="min-h-16 text-sm"
              placeholder={t("detail.reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {stepActions.length > 0 ? (
                stepActions
                  .filter((action) => action !== "reject")
                  .map((action, index) => {
                    const ActionIcon = ACTION_ICONS[action] ?? Check;
                    return (
                      <Button
                        key={action}
                        type="button"
                        variant={index === 0 ? "default" : "outline"}
                        className="h-9"
                        disabled={decide.isPending || (action === "approve" && fuelApproveBlocked)}
                        onClick={() => {
                          if (action === "approve" && fuelApproveBlocked) {
                            toast.error(t("detail.fuelTransfer.requiredBeforeApprove"));
                            return;
                          }
                          if (action === "approve" && termsOnApprove) {
                            setTermsMode("approve");
                            return;
                          }
                          if (action === "reschedule") {
                            setRescheduleOpen(true);
                            return;
                          }
                          void runAction(action);
                        }}
                      >
                        <ActionIcon className="me-1.5 h-3.5 w-3.5" />
                        {t(`detail.actionLabels.${action}` as "detail.actionLabels.approve")}
                      </Button>
                    );
                  })
              ) : (
                <Button
                  type="button"
                  className="h-9"
                  disabled={decide.isPending}
                  onClick={() => void runAction("solve")}
                >
                  <Check className="me-1.5 h-3.5 w-3.5" />
                  {t("detail.solve")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="h-9 text-destructive hover:bg-destructive/10"
                disabled={decide.isPending}
                onClick={() => void runAction("reject")}
              >
                <X className="me-1.5 h-3.5 w-3.5" />
                {t("detail.reject")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={decide.isPending}
                onClick={() => void runAction("clarify")}
              >
                <MessageCircleQuestion className="me-1.5 h-3.5 w-3.5" />
                {t("detail.clarify")}
              </Button>
            </div>
          </section>
        ) : null}

        {canClose ? (
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{t("detail.closeRequest.title")}</h2>
                <p className="text-[10px] text-muted-foreground">{t("detail.closeRequest.hint")}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0"
                disabled={decide.isPending}
                onClick={() => void runAction("close", { reasonOverride: "" })}
              >
                <Archive className="me-1.5 h-3.5 w-3.5" />
                {t("detail.closeRequest.action")}
              </Button>
            </div>
          </section>
        ) : null}

        {takesTerms && decided && request.status !== "rejected" ? (
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t("detail.terms.cardTitle")}</h2>
              {canDecide ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => setTermsMode("edit")}
                >
                  <Pencil className="me-1.5 h-3.5 w-3.5" />
                  {t("detail.terms.edit")}
                </Button>
              ) : null}
            </div>
            <div className="divide-y divide-border rounded-lg border border-border text-sm">
              {termRowsFor(request.request_type, currentTerms).map((row) => (
                <RequestFieldRow
                  key={row.key}
                  label={t(`detail.terms.${row.key}` as "detail.terms.approvedAmount")}
                  muted={row.value == null}
                >
                  <span className={cn(row.value == null && "text-[11px] text-warning")}>
                    {row.value ?? t("detail.terms.notSet")}
                  </span>
                </RequestFieldRow>
              ))}
            </div>
            <div
              className={cn(
                "mt-2 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5",
                acknowledged
                  ? "border-success/30 bg-success-bg"
                  : "border-warning/30 bg-warning-bg",
              )}
            >
              <p
                className={cn(
                  "flex items-center gap-1.5 text-[10px]",
                  acknowledged ? "text-success" : "text-warning",
                )}
              >
                {acknowledged ? (
                  <Check className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                {t(acknowledged ? "detail.terms.ackDone" : "detail.terms.ackHint")}
              </p>
              <StatusPill
                dot
                variant={requestStatusVariant(request.status, request.payload)}
                className="shrink-0"
              >
                {t(`status.${requestStatusLabelKey(request.status, request.payload)}` as "status.pending")}
              </StatusPill>
            </div>
            {acknowledged && ackNote ? (
              <div className="mt-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("detail.terms.riderNote")}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm">{ackNote}</p>
              </div>
            ) : null}
          </section>
        ) : null}
        </div>
      </div>

      {takesTerms ? (
        <RequestDecisionTermsDialog
          open={termsMode != null}
          onOpenChange={(next) => setTermsMode(next ? termsMode : null)}
          requestType={request.request_type}
          requestCode={request.request_code}
          initialTerms={currentTerms}
          mode={termsMode ?? "approve"}
          submitting={decide.isPending || saveTerms.isPending}
          onSubmit={(terms) => {
            if (termsMode === "edit") {
              void submitTermsEdit(terms);
              return;
            }
            void runAction("approve", { terms });
          }}
        />
      ) : null}

      <RequestRescheduleDialog
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        requestCode={request.request_code}
        currentStartDate={request.start_date}
        currentEndDate={request.end_date}
        submitting={decide.isPending}
        onSubmit={(input, note) =>
          void runAction("reschedule", { reschedule: input, reasonOverride: note })
        }
      />
    </AppPage>
  );
}
