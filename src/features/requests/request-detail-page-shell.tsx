"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  Check,
  CheckCircle2,
  Download,
  FileText,
  FileUp,
  Forward,
  Loader2,
  MessageCircleQuestion,
  MessageSquare,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { attachmentDisplayName } from "./attachment-display-name";
import { decidedTerms, overlayDecisionTerms } from "./decided-terms";
import {
  fetchRequestAttachmentUrl,
  logAdminRequestDetailOpened,
  saveRequestClosingRemark,
} from "./requests-actions";
import { RequestApprovalTimeline } from "./request-approval-timeline";
import { fileToDecisionAttachmentPayload, RequestAttachDialog } from "./request-attach-dialog";
import { RequestDecisionTermsDialog } from "./request-decision-terms-dialog";
import { RequestFieldRow } from "./request-field-row";
import { RequestFuelTransferCard } from "./request-fuel-transfer-card";
import { RequestRescheduleDialog } from "./request-reschedule-dialog";
import { RequestRescheduleSummary } from "./request-reschedule-summary";
import { RequestCommentsThread } from "./request-comments-thread";
import { RequestForwardDialog } from "./request-forward-dialog";
import { RequestTypedDrawer } from "./request-typed-drawer";
import {
  formatFieldValue,
  getExtraPayloadRows,
  getTypedFieldRows,
} from "./request-typed-fields";
import {
  canCloseRequest,
  isAdvancingRequestAction,
  isAwaitingDriverClarification,
  isAwaitingRescheduleReply,
  isDriverAcknowledged,
  requestStatusLabelKey,
  requestStatusVariant,
} from "./request-status-utils";
import {
  fuelApproveBlocked as isFuelApproveBlocked,
  isAttachRequiredAction,
  parseDriverAckNote,
  shouldOfferRequestDocumentsAction,
} from "./request-create-utils";
import { FleetAttachmentRow } from "@/features/fleet/fleet-attachment-row";
import { CarTypeBadge, FuelCompanyBadge, ProjectBadge } from "@/features/fleet/fleet-badges";
import { FleetDetailRow } from "@/features/fleet/fleet-record-dialog";
import { RequestRecordBody } from "./request-record-body";
import { RequesterHeader } from "./requester-header";
import { DECISION_TERM_TYPES } from "./types";
import type {
  RequestApprovalStep,
  RequestDecisionAttachment,
  RequestDecisionTerms,
  RequestRescheduleInput,
} from "./types";
import {
  useAdminRequestDetail,
  useDecideRequest,
  useEscalateRequest,
  useSaveDecisionTerms,
  useUploadStaffRequestAttachments,
} from "./use-requests";

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

const WAVE4_TYPES = new Set(["loan", "complaint"]);
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function complaintAgainst(payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return "—";
  for (const key of ["against_name", "against", "complained_against"]) {
    const value = payload[key];
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (!text || UUID_TEXT.test(text)) continue;
    return text;
  }
  return "—";
}

const SUBMITTED_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuwait",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DECISION_STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuwait",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

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
  const tRcm = useTranslations("pages.rcmV2");
  const fleetT = useTranslations("pages.fleetFuelQueue");
  const pathname = usePathname();
  const { can, userId, adminRoleSlug } = useAuth();
  const canDecide = can("requests.approve") || can("requests.manage");
  const fromEmployeeDesk = pathname.includes("/employeedesk");
  const { data, isLoading, refetch } = useAdminRequestDetail(requestId);
  const decide = useDecideRequest(requestId);
  const uploadAttachments = useUploadStaffRequestAttachments(requestId);
  const saveTerms = useSaveDecisionTerms(requestId);
  const [reason, setReason] = useState("");
  const [termsMode, setTermsMode] = useState<"approve" | "edit" | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [attachAction, setAttachAction] = useState<"attach_send" | "attach_breakdown" | null>(
    null,
  );
  const [heldTerms, setHeldTerms] = useState<RequestDecisionTerms | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [closingRemark, setClosingRemark] = useState("");
  const escalate = useEscalateRequest();

  useEffect(() => {
    if (!requestId) return;
    void logAdminRequestDetailOpened(requestId);
  }, [requestId]);

  useEffect(() => {
    setHeldTerms(null);
  }, [requestId]);

  const request = data?.request;
  const steps = data?.steps ?? [];
  const clarifications = data?.clarifications ?? [];
  const attachments = data?.attachments ?? [];
  const comments = data?.comments ?? [];
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
  // The rider owes an answer to a clarification. The server refuses anything but
  // reject / clarify in this state, so the row is narrowed rather than removed —
  // an operator must still be able to close the request out.
  const awaitingClarification =
    request != null && isAwaitingDriverClarification(request.status);
  const stepActions = currentStepAllowedActions(steps).filter(
    (action) =>
      action !== "request_documents" || shouldOfferRequestDocumentsAction(attachments.length),
  );
  const REASON_REQUIRED_ACTIONS = new Set(["reject", "clarify", "send_response"]);
  const canClose =
    request != null && canDecide && canCloseRequest(request.status, request.completed_at);
  const takesTerms =
    request != null &&
    (DECISION_TERM_TYPES as readonly string[]).includes(request.request_type);
  const currentTerms = overlayDecisionTerms(decidedTerms(steps), heldTerms);
  const acknowledged = request != null && isDriverAcknowledged(request.status, request.payload);
  const termsOnApprove = takesTerms && isFinalApprovalStep(steps);
  const fuelApproveBlocked =
    request != null &&
    isFuelApproveBlocked({
      requestType: request.request_type,
      fuelTransferType: request.fuel_transfer_type,
    });
  const parsedAck = parseDriverAckNote(
    typeof request?.payload?.driver_ack_note === "string"
      ? request.payload.driver_ack_note
      : "",
  );

  const decidePending = decide.isPending || uploadAttachments.isPending;
  const pendingStepName = steps.find((step) => step.status === "in_progress")?.step_name ?? null;

  const decideErrorMessage = (error: string | undefined) => {
    if (error === "fuel_transfer_type_required") {
      return t("detail.fuelTransfer.requiredBeforeApprove");
    }
    if (error === "attachment_required") return t("detail.attach.required");
    if (error === "invalid_attachment_type") return t("detail.attach.invalidType");
    if (error === "invalid_attachment_size") return t("detail.attach.invalidSize");
    if (error === "reschedule_note_required") {
      return t("detail.reschedule.noteRequired");
    }
    if (error === "awaiting_driver_clarification") {
      return t("detail.awaitingClarification");
    }
    return error ?? t("detail.actionFailed");
  };

  const runAction = async (
    action: string,
    options?: {
      terms?: RequestDecisionTerms;
      reschedule?: RequestRescheduleInput;
      reasonOverride?: string;
      attachments?: RequestDecisionAttachment[];
      toastMode?: "default" | "approved";
      closingRemark?: string;
    },
  ) => {
    const note = (options?.reasonOverride ?? reason).trim();
    if (action === "approve" && fuelApproveBlocked) {
      toast.error(t("detail.fuelTransfer.requiredBeforeApprove"));
      return false;
    }
    if (REASON_REQUIRED_ACTIONS.has(action) && !note) {
      toast.error(t("detail.reasonRequired"));
      return false;
    }
    if (isAttachRequiredAction(action) && (options?.attachments?.length ?? 0) < 1) {
      toast.error(t("detail.attach.required"));
      return false;
    }
    if (options?.terms) setHeldTerms(options.terms);
    const result = await decide.mutateAsync({
      action,
      reason: note || undefined,
      terms: options?.terms,
      reschedule: options?.reschedule,
      attachments: options?.attachments,
    });
    if (!result.ok) {
      toast.error(decideErrorMessage(result.error));
      return false;
    }
    if (action === "send_response" && options?.closingRemark?.trim()) {
      const saved = await saveRequestClosingRemark({
        requestId,
        remark: options.closingRemark.trim(),
      });
      if (!saved.ok) toast.error(saved.error ?? t("detail.actionFailed"));
    }
    if (options?.toastMode === "approved") {
      const message = pendingStepName
        ? tRcm("decision.approvedToast", { next: pendingStepName })
        : tRcm("decision.approvedToastDone");
      toast.success(message, {
        position: "top-right",
        unstyled: true,
        icon: <Check className="size-4 shrink-0" />,
        className:
          "flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg",
      });
    } else {
      toast.success(t("detail.actionOk"));
    }
    setReason("");
    setClosingRemark("");
    setTermsMode(null);
    setRescheduleOpen(false);
    setAttachAction(null);
    await refetch();
    return true;
  };

  const submitTermsEdit = async (terms: RequestDecisionTerms) => {
    setHeldTerms(terms);
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

  const isLoan = request.request_type === "loan";
  const isComplaint = request.request_type === "complaint";
  const wave4Layout = WAVE4_TYPES.has(request.request_type);
  const nextStep = steps.find((step) => step.status === "in_progress");
  const lastCompleted = [...steps].filter((step) => step.status === "completed").at(-1);
  const youApproved = Boolean(lastCompleted?.decided_by === userId && nextStep && !decided);
  const showApprovedBanner = youApproved;
  const listHref = fromEmployeeDesk
    ? `/employeedesk/all?type=${request.request_type}&preset=all`
    : "/requests/overview";
  const allowsAction = (action: string) =>
    stepActions.length === 0 || stepActions.includes(action);
  const showDecisionCard = canDecide && !decided && !awaitingRider && !youApproved;
  const submittedOn = Number.isNaN(new Date(request.created_at).getTime())
    ? "—"
    : SUBMITTED_FORMAT.format(new Date(request.created_at));
  const approvedStamp =
    lastCompleted?.decided_at && !Number.isNaN(new Date(lastCompleted.decided_at).getTime())
      ? DECISION_STAMP.format(new Date(lastCompleted.decided_at))
      : null;
  const typeLabel = tRcm(`types.${request.request_type}` as "types.loan");
  function viewerRole(): string {
    const slug = adminRoleSlug;
    switch (slug) {
      case "operator":
        return tRcm("decision.roles.operator");
      case "administrator":
        return tRcm("decision.roles.administrator");
      case "super_admin":
        return tRcm("decision.roles.super_admin");
      case "account":
        return tRcm("decision.roles.account");
      case "":
        return tRcm("access.receiver");
      default:
        return slug.replaceAll("_", " ");
    }
  }

  return (
    <AppPage>
      {wave4Layout ? (
        <div className="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-0 text-muted-foreground hover:bg-transparent"
            render={<Link href={listHref} />}
          >
            <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
            {fromEmployeeDesk ? tRcm("decision.backToIncoming") : t("detail.back")}
          </Button>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              {isComplaint ? (
                <MessageSquare className="mt-0.5 size-5 shrink-0 text-rose-500" />
              ) : (
                <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <h1 className="text-xl font-semibold">
                  {isComplaint ? typeLabel : tRcm("decision.typeRequest", { type: typeLabel })}
                </h1>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {tRcm("decision.submittedLine", { code: request.request_code, when: submittedOn })}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-800">
                {tRcm("youReceive")}
              </span>
              <StatusPill
                dot
                variant={youApproved ? "success" : requestStatusVariant(request.status, request.payload)}
              >
                {youApproved
                  ? t("status.approved")
                  : t(`status.${requestStatusLabelKey(request.status, request.payload)}` as "status.pending")}
              </StatusPill>
              <RequestTypedDrawer request={request} steps={steps} attachments={attachments} />
            </div>
          </div>
        </div>
      ) : (
        <AppPageHeader
          title={request.request_code}
          description={`${t(`types.${request.request_type}` as "types.leave")} · ${request.current_step_label ?? "—"}`}
          actions={
            <div className="flex items-center gap-2">
              <StatusPill dot variant={requestStatusVariant(request.status, request.payload)}>
                {t(`status.${requestStatusLabelKey(request.status, request.payload)}` as "status.pending")}
              </StatusPill>
              <RequestTypedDrawer request={request} steps={steps} attachments={attachments} />
              <Button variant="outline" size="sm" className="h-9" render={<Link href={listHref} />}>
                <ArrowLeft className="me-1.5 h-3.5 w-3.5" />
                {t("detail.back")}
              </Button>
            </div>
          }
        />
      )}

      {request.is_confidential ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          {wave4Layout && isComplaint
            ? tRcm("decision.confidentialBanner")
            : t("detail.confidentialBanner")}
        </p>
      ) : null}

      {showApprovedBanner && !wave4Layout ? (
        <p className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {t("status.approved")}
          {nextStep?.step_name ? ` — ${nextStep.step_name}` : null}
        </p>
      ) : null}

      {wave4Layout ? (
        <div className="grid gap-2 lg:grid-cols-2 lg:items-stretch">
          <div className="flex h-full min-w-0 flex-col gap-2">
            <section className="h-full rounded-xl border border-border bg-card p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold">{t("detail.fields")}</h2>
              <div className="mb-3 grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {tRcm("access.sender")}
                  </p>
                  <RequesterHeader
                    variant="inline"
                    driverId={request.driver_id}
                    requestId={request.id}
                    requester={request.requester}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {["Rider", request.requester?.zone, request.requester?.code]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {tRcm("access.receiver")}
                  </p>
                  <p className="text-sm font-semibold">
                    {tRcm("decision.youRole", { role: viewerRole() })}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {nextStep?.step_name
                      ? tRcm("decision.next", { step: nextStep.step_name })
                      : "—"}
                  </p>
                </div>
              </div>
              {isComplaint ? (
                <div className="mb-3 grid gap-2 sm:grid-cols-3">
                  {(["category", "severity"] as const).map((key) => {
                    const row = allDetailRows.find((item) => item.key === key);
                    return (
                      <div key={key} className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {row?.label ?? key}
                        </p>
                        <p
                          className={cn(
                            "text-sm font-medium",
                            key === "severity" &&
                              (request.severity ?? row?.value ?? "").trim().toLowerCase() === "high" &&
                              "inline-flex rounded-md bg-rose-100 px-2 py-0.5 text-rose-800",
                          )}
                        >{row?.value && row.value !== "—" ? row.value : "—"}</p>
                      </div>
                    );
                  })}
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {tRcm("decision.against")}
                    </p>
                    <p className="text-sm font-medium">{complaintAgainst(request.payload)}</p>
                  </div>
                </div>
              ) : null}
              {subjectRow ? (
                <RequestFieldRow label={t("detail.subject")}>{subjectRow.value}</RequestFieldRow>
              ) : null}
              {(() => {
                const boxed =
                  allDetailRows.find((row) => row.key === "reason" || row.key === "description") ??
                  (message ? { key: "message", label: t("detail.message"), value: message, gatedKey: undefined } : null);
                const gridRows = allDetailRows.filter(
                  (row) =>
                    row.key !== "reason" &&
                    row.key !== "description" &&
                    row.key !== "subject" &&
                    !(isComplaint && (row.key === "category" || row.key === "severity")),
                );
                return (
                  <>
                    {gridRows.length > 0 ? (
                      <div className="grid gap-1 sm:grid-cols-2">
                        {gridRows.map((row) => (
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
                    ) : null}
                    {boxed && boxed.value !== "—" ? (
                      <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {boxed.label}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm">{boxed.value}</p>
                      </div>
                    ) : null}
                    {gridRows.length === 0 && !subjectRow && !boxed ? (
                      <p className="text-xs text-muted-foreground">{t("detail.noTypedFields")}</p>
                    ) : null}
                  </>
                );
              })()}
              <div className="mt-3 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("detail.attachments")}
                </p>
                {attachments.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">{t("detail.noAttachments")}</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {attachments.map((item) => (
                      <FleetAttachmentRow
                        key={item.id}
                        title={item.title ?? attachmentDisplayName(item.file_name, item.storage_key)}
                        fileName={attachmentDisplayName(item.file_name, item.storage_key)}
                        capturedAt={item.captured_at}
                        source={item.source}
                        onOpen={item.storage_key ? () => void openAttachment(item.storage_key) : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
            <RequestCommentsThread
              requestId={requestId}
              comments={comments}
              heading={
                isComplaint
                  ? tRcm("decision.commentsOnComplaint")
                  : tRcm("decision.commentsOnRequest")
              }
            />
            {clarifications.length > 0 ? (
              <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <h3 className="text-xs font-semibold text-muted-foreground">{t("detail.clarifications")}</h3>
                {clarifications.map((c) => (
                  <div key={c.id} className="mt-2 rounded-lg border border-border p-2 text-xs">
                    <p className="font-medium">{c.question}</p>
                    {c.answer ? (
                      <p className="mt-1 text-muted-foreground">{c.answer}</p>
                    ) : (
                      <p className="mt-1 text-warning">{t("detail.awaitingAnswer")}</p>
                    )}
                  </div>
                ))}
              </section>
            ) : null}
          </div>

          <div className="flex h-full min-w-0 flex-col gap-2">
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold">
                {isComplaint ? t("detail.resolutionRoute") : t("detail.approvalRoute")}
              </h2>
              <RequestApprovalTimeline steps={steps} />
            </section>

            {request ? <RequestRescheduleSummary payload={request.payload} /> : null}

            {awaitingRider ? (
              <section className="rounded-xl border border-warning/30 bg-warning-bg p-4">
                <p className="flex items-center gap-1.5 text-xs text-warning">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                  {t("detail.reschedule.awaitingRider")}
                </p>
              </section>
            ) : null}

            {youApproved ? (
              <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <p className="flex items-start gap-2 text-sm font-semibold">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>
                    <span className="block">{tRcm("decision.youApproved")}</span>
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {approvedStamp ?? "—"}
                    </span>
                  </span>
                </p>
              </section>
            ) : null}

            {showDecisionCard ? (
              <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold">
                  {isComplaint ? tRcm("decision.yourResponse") : tRcm("decision.yourDecision")}
                </h2>
                {awaitingClarification ? (
                  <p className="mb-2 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning-bg px-2 py-1.5 text-[10px] text-warning">
                    <MessageCircleQuestion className="mt-px h-3.5 w-3.5 shrink-0" />
                    <span>{t("detail.awaitingClarification")}</span>
                  </p>
                ) : null}
                <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {isComplaint ? tRcm("decision.responseLabel") : tRcm("decision.commentLabel")}
                </Label>
                <Textarea
                  className="mt-1.5 min-h-16 text-sm"
                  placeholder={
                    isComplaint
                      ? tRcm("decision.responsePlaceholder")
                      : tRcm("decision.commentPlaceholder")
                  }
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                {isComplaint ? (
                  <div className="mt-3">
                    <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {tRcm("decision.closingRemark")}
                    </Label>
                    <Textarea
                      className="mt-1.5 min-h-16 text-sm"
                      placeholder={tRcm("decision.closingPlaceholder")}
                      value={closingRemark}
                      onChange={(e) => setClosingRemark(e.target.value)}
                    />
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {isLoan ? (
                    <>
                      <Button
                        type="button"
                        className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
                        disabled={
                          decidePending ||
                          (awaitingClarification && isAdvancingRequestAction("approve")) ||
                          !allowsAction("approve")
                        }
                        onClick={() => {
                          if (awaitingClarification && isAdvancingRequestAction("approve")) {
                            toast.error(t("detail.awaitingClarification"));
                            return;
                          }
                          if (termsOnApprove) {
                            setTermsMode("approve");
                            return;
                          }
                          setApproveOpen(true);
                        }}
                      >
                        {t("detail.actionLabels.approve")}
                      </Button>
                      <Button
                        type="button"
                        className="h-9 bg-destructive text-white hover:bg-destructive/90"
                        disabled={decidePending}
                        onClick={() => setRejectOpen(true)}
                      >
                        {t("detail.reject")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9"
                        disabled={decidePending}
                        onClick={() => setForwardOpen(true)}
                      >
                        {t("detail.forward")}
                      </Button>
                    </>
                  ) : null}
                  {isComplaint ? (
                    <>
                      <Button
                        type="button"
                        className="h-9 bg-zinc-950 text-white hover:bg-zinc-800"
                        disabled={
                          decidePending ||
                          (awaitingClarification && isAdvancingRequestAction("send_response")) ||
                          !allowsAction("send_response")
                        }
                        onClick={() => {
                          if (awaitingClarification && isAdvancingRequestAction("send_response")) {
                            toast.error(t("detail.awaitingClarification"));
                            return;
                          }
                          void runAction("send_response", { closingRemark });
                        }}
                      >
                        {tRcm("decision.sendResponse")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9"
                        disabled={decidePending}
                        onClick={() => setForwardOpen(true)}
                      >
                        {t("detail.forward")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 text-foreground"
                        disabled={decidePending || escalate.isPending}
                        onClick={async () => {
                          const result = await escalate.mutateAsync({ requestId, note: reason });
                          if (!result.ok) toast.error(result.error ?? t("detail.escalateFailed"));
                          else toast.success(t("detail.escalated"));
                        }}
                      >
                        {tRcm("decision.escalate")}
                      </Button>
                    </>
                  ) : null}
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">{tRcm("decision.auditFootnote")}</p>
                {stepActions.filter(
                  (action) =>
                    action !== "reject" &&
                    (isLoan
                      ? action !== "approve"
                      : action !== "send_response" && action !== "escalate"),
                ).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {stepActions
                      .filter((action) =>
                        isLoan
                          ? action !== "approve" && action !== "reject"
                          : action !== "send_response" &&
                            action !== "escalate" &&
                            action !== "reject",
                      )
                      .map((action) => {
                        const ActionIcon = ACTION_ICONS[action] ?? Check;
                        const blockedByClarification =
                          awaitingClarification && isAdvancingRequestAction(action);
                        return (
                          <Button
                            key={action}
                            type="button"
                            variant="outline"
                            className="h-9"
                            disabled={decidePending || blockedByClarification}
                            onClick={() => {
                              if (blockedByClarification) {
                                toast.error(t("detail.awaitingClarification"));
                                return;
                              }
                              if (action === "reschedule") {
                                setRescheduleOpen(true);
                                return;
                              }
                              if (action === "attach_send" || action === "attach_breakdown") {
                                setAttachAction(action);
                                return;
                              }
                              void runAction(action);
                            }}
                          >
                            <ActionIcon className="me-1.5 h-3.5 w-3.5" />
                            {t(`detail.actionLabels.${action}` as "detail.actionLabels.approve")}
                          </Button>
                        );
                      })}
                  </div>
                ) : null}
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
                    disabled={decidePending}
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
              </section>
            ) : null}
          </div>
        </div>
      ) : (
      <RequestRecordBody
        summary={request.amount_kwd != null ? `${request.amount_kwd.toFixed(3)} KWD` : undefined}
        requester={
          <RequesterHeader
            driverId={request.driver_id}
            requestId={request.id}
            requester={request.requester}
          />
        }
        employee={
          <>
            <FleetDetailRow label={fleetT("colDriver")}>{request.requester?.name ?? "—"}</FleetDetailRow>
            <FleetDetailRow label={fleetT("fieldEmployeeId")}>—</FleetDetailRow>
            <FleetDetailRow label={fleetT("colEmpCompany")}>—</FleetDetailRow>
            <FleetDetailRow label={fleetT("fieldPhone")}>{request.requester?.phone ?? "—"}</FleetDetailRow>
            <FleetDetailRow label={fleetT("colProject")}>
              <ProjectBadge value={null} />
            </FleetDetailRow>
            <FleetDetailRow label={fleetT("colZone")}>{request.requester?.zone ?? "—"}</FleetDetailRow>
          </>
        }
        vehicle={
          <>
            <FleetDetailRow label={fleetT("fieldPlate")}>—</FleetDetailRow>
            <FleetDetailRow label={fleetT("fieldModel")}>—</FleetDetailRow>
            <FleetDetailRow label={fleetT("colVehicleCompany")}>—</FleetDetailRow>
            {request.request_type === "fuel" || request.request_type === "fuel_refund" ? (
              <>
                <FleetDetailRow label={fleetT("fieldCarType")}>
                  <CarTypeBadge value={null} />
                </FleetDetailRow>
                <FleetDetailRow label={fleetT("colFuelCompany")}>
                  <FuelCompanyBadge value={null} />
                </FleetDetailRow>
              </>
            ) : null}
          </>
        }
        fields={
          <>
            {subjectRow ? (
              <FleetDetailRow label={t("detail.subject")}>{subjectRow.value}</FleetDetailRow>
            ) : null}
            {message ? <FleetDetailRow label={t("detail.message")}>{message}</FleetDetailRow> : null}
            {allDetailRows.length === 0 && !subjectRow && !message ? (
              <p className="text-xs text-muted-foreground">{t("detail.noTypedFields")}</p>
            ) : (
              allDetailRows.map((row) => (
                <FleetDetailRow key={row.key} label={row.label} muted={row.value === "—" && !row.gatedKey}>
                  {row.gatedKey ? (
                    <span className="text-[11px] font-normal text-warning">
                      {t(`detail.${row.gatedKey}` as "detail.categoryGated")}
                    </span>
                  ) : (
                    row.value
                  )}
                </FleetDetailRow>
              ))
            )}
          </>
        }
        evidence={
          attachments.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("detail.noAttachments")}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {attachments.map((item) => (
                <FleetAttachmentRow
                  key={item.id}
                  title={item.title ?? attachmentDisplayName(item.file_name, item.storage_key)}
                  fileName={attachmentDisplayName(item.file_name, item.storage_key)}
                  capturedAt={item.captured_at}
                  source={item.source}
                  onOpen={item.storage_key ? () => void openAttachment(item.storage_key) : undefined}
                />
              ))}
            </div>
          )
        }
        approval={
          <>
            <RequestApprovalTimeline steps={steps} />
            <div className="mt-3">
              <RequestCommentsThread requestId={requestId} comments={comments} />
            </div>
            {clarifications.length > 0 ? (
              <div className="mt-3 space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground">{t("detail.clarifications")}</h3>
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
          </>
        }
        side={
          <>
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
              {request.request_type === "fuel" || request.request_type === "fuel_refund" ? (
                <>
                  <FleetDetailRow label={fleetT("fieldTransfer")} muted={request.fuel_transfer_type == null}>
                    {request.fuel_transfer_type == null
                      ? t("detail.fuelTransfer.notSet")
                      : t(`detail.fuelTransfer.options.${request.fuel_transfer_type}` as "detail.fuelTransfer.options.cash")}
                  </FleetDetailRow>
                  <RequestFuelTransferCard
                    requestId={request.id}
                    value={request.fuel_transfer_type}
                    editable={canDecide && request.status !== "closed"}
                    compact
                  />
                </>
              ) : null}
              <FleetDetailRow label={fleetT("colStatus")}>
                <StatusPill dot variant={requestStatusVariant(request.status, request.payload)}>
                  {t(`status.${requestStatusLabelKey(request.status, request.payload)}` as "status.pending")}
                </StatusPill>
              </FleetDetailRow>
            </div>

        {request ? <RequestRescheduleSummary payload={request.payload} /> : null}

        {awaitingRider ? (
          <section className="rounded-xl border border-warning/30 bg-warning-bg p-4">
            <p className="flex items-center gap-1.5 text-xs text-warning">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              {t("detail.reschedule.awaitingRider")}
            </p>
          </section>
        ) : null}

        {canDecide && !decided && !awaitingRider ? (
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">{t("detail.actions")}</h2>
            {awaitingClarification ? (
              <p className="mb-2 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning-bg px-2 py-1.5 text-[10px] text-warning">
                <MessageCircleQuestion className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{t("detail.awaitingClarification")}</span>
              </p>
            ) : null}
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
                    const blockedByClarification =
                      awaitingClarification && isAdvancingRequestAction(action);
                    return (
                      <Button
                        key={action}
                        type="button"
                        variant={index === 0 ? "default" : "outline"}
                        className="h-9"
                        disabled={
                          decidePending ||
                          blockedByClarification ||
                          (action === "approve" && fuelApproveBlocked)
                        }
                        onClick={() => {
                          if (blockedByClarification) {
                            toast.error(t("detail.awaitingClarification"));
                            return;
                          }
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
                          if (action === "attach_send" || action === "attach_breakdown") {
                            setAttachAction(action);
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
                  disabled={decidePending || awaitingClarification}
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
                disabled={decidePending}
                onClick={() => setRejectOpen(true)}
              >
                <X className="me-1.5 h-3.5 w-3.5" />
                {t("detail.reject")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={decidePending}
                onClick={() => void runAction("clarify")}
              >
                <MessageCircleQuestion className="me-1.5 h-3.5 w-3.5" />
                {t("detail.clarify")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={decidePending}
                onClick={() => setForwardOpen(true)}
              >
                <Forward className="me-1.5 h-3.5 w-3.5" />
                {t("detail.forward")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={decidePending || escalate.isPending}
                onClick={async () => {
                  const result = await escalate.mutateAsync({ requestId, note: reason });
                  if (!result.ok) toast.error(result.error ?? t("detail.escalateFailed"));
                  else toast.success(t("detail.escalated"));
                }}
              >
                <AlertCircle className="me-1.5 h-3.5 w-3.5" />
                {t("detail.escalate")}
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
                disabled={decidePending}
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
            {acknowledged && (parsedAck.text || parsedAck.keys.length > 0) ? (
              <div className="mt-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("detail.terms.riderNote")}
                </p>
                {parsedAck.text ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-sm">{parsedAck.text}</p>
                ) : null}
                {parsedAck.keys.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {parsedAck.keys.map((key) => (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => void openAttachment(key)}
                          className="inline-flex items-center gap-1.5 text-sm text-primary hover:bg-primary/10"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {key.split("/").pop() ?? key}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
          </>
        }
      />
      )}

      {takesTerms ? (
        <RequestDecisionTermsDialog
          open={termsMode != null}
          onOpenChange={(next) => setTermsMode(next ? termsMode : null)}
          requestType={request.request_type}
          requestCode={request.request_code}
          initialTerms={currentTerms}
          mode={termsMode ?? "approve"}
          submitting={decidePending || saveTerms.isPending}
          onSubmit={(terms) => {
            if (termsMode === "edit") {
              void submitTermsEdit(terms);
              return;
            }
            void runAction("approve", {
              terms,
              toastMode: wave4Layout ? "approved" : "default",
            });
          }}
        />
      ) : null}

      <RequestForwardDialog
        open={forwardOpen}
        onOpenChange={setForwardOpen}
        requestId={requestId}
        requestCode={request.request_code}
        requestTypeLabel={tRcm(`types.${request.request_type}` as "types.loan")}
        fromName={request.requester?.name}
      />

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="flex w-[min(520px,96vw)] flex-col gap-0 rounded-xl p-0" showCloseButton={!decidePending}>
          <DialogHeader className="border-b border-border px-5 py-3 pe-14">
            <DialogTitle>{tRcm("decision.approveTitle", { type: typeLabel })}</DialogTitle>
            <DialogDescription>{tRcm("decision.approveConsequence")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 px-5 py-4">
            <Label htmlFor="approve-comment" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {tRcm("decision.yourComment")}
            </Label>
            <Textarea
              id="approve-comment"
              className="min-h-20 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter className="border-t border-border px-5 py-3 sm:justify-end">
            <Button type="button" variant="outline" className="h-9" disabled={decidePending} onClick={() => setApproveOpen(false)}>
              {tRcm("decision.cancel")}
            </Button>
            <Button
              type="button"
              className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={decidePending}
              onClick={() => {
                void (async () => {
                  const ok = await runAction("approve", { toastMode: "approved" });
                  if (ok) setApproveOpen(false);
                })();
              }}
            >
              {decidePending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="me-1.5 h-3.5 w-3.5" />}
              {tRcm("decision.approveRequest")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="flex w-[min(520px,96vw)] flex-col gap-0 rounded-xl p-0" showCloseButton={!decidePending}>
          <DialogHeader className="border-b border-border px-5 py-3 pe-14">
            <DialogTitle>{tRcm("decision.rejectTitle", { type: typeLabel })}</DialogTitle>
            <DialogDescription>
              {tRcm("decision.rejectConsequence", {
                name: request.requester?.name || tRcm("decision.employee"),
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 px-5 py-4">
            <Label htmlFor="reject-comment" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {tRcm("decision.yourComment")}
              <span className="ms-0.5 text-destructive">*</span>
            </Label>
            <Textarea
              id="reject-comment"
              className="min-h-20 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter className="border-t border-border px-5 py-3 sm:justify-end">
            <Button type="button" variant="outline" className="h-9" disabled={decidePending} onClick={() => setRejectOpen(false)}>
              {tRcm("decision.cancel")}
            </Button>
            <Button
              type="button"
              className="h-9 bg-destructive text-white hover:bg-destructive/90"
              disabled={!reason.trim() || decidePending}
              onClick={() => {
                void (async () => {
                  const ok = await runAction("reject");
                  if (ok) setRejectOpen(false);
                })();
              }}
            >
              {decidePending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {tRcm("decision.rejectRequest")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RequestRescheduleDialog
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        requestCode={request.request_code}
        currentStartDate={request.start_date}
        currentEndDate={request.end_date}
        submitting={decidePending}
        onSubmit={(input, note) =>
          void runAction("reschedule", { reschedule: input, reasonOverride: note })
        }
      />

      <RequestAttachDialog
        open={attachAction != null}
        onOpenChange={(next) => setAttachAction(next ? attachAction : null)}
        action={attachAction}
        requestCode={request.request_code}
        submitting={decidePending}
        onSubmit={(files) => {
          void (async () => {
            const payloads = await Promise.all(files.map(fileToDecisionAttachmentPayload));
            const uploaded = await uploadAttachments.mutateAsync(payloads);
            if (!uploaded.ok || !uploaded.attachments?.length) {
              toast.error(decideErrorMessage(uploaded.error));
              return;
            }
            if (!attachAction) return;
            await runAction(attachAction, { attachments: uploaded.attachments });
          })();
        }}
      />
    </AppPage>
  );
}
