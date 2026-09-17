"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Car,
  Check,
  FileText,
  Loader2,
  MessageCircleQuestion,
  User,
  X,
} from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/dashboard/status-pill";
import { SectionHeading } from "@/features/drivers/form/driver-form-primitives";
import { FleetAttachmentRow } from "@/features/fleet/fleet-attachment-row";
import { CarTypeBadge, FuelCompanyBadge, ProjectBadge } from "@/features/fleet/fleet-badges";
import { FleetDetailRow, FleetRecordDialog } from "@/features/fleet/fleet-record-dialog";
import { useAuth } from "@/contexts/auth-context";
import { RequestApprovalTimeline } from "@/features/requests/request-approval-timeline";
import { RequestFuelTransferCard } from "@/features/requests/request-fuel-transfer-card";
import { RequesterHeader } from "@/features/requests/requester-header";
import {
  fuelApproveBlocked as isFuelApproveBlocked,
  shouldOfferRequestDocumentsAction,
} from "@/features/requests/request-create-utils";
import {
  requestStatusLabelKey,
  requestStatusVariant,
} from "@/features/requests/request-status-utils";
import { getTypedFieldRows } from "@/features/requests/request-typed-fields";
import {
  fetchRequestAttachmentUrl,
  logAdminRequestDetailOpened,
} from "@/features/requests/requests-actions";
import type { RequestApprovalStep } from "@/features/requests/types";
import { useAdminRequestDetail, useDecideRequest } from "@/features/requests/use-requests";
import {
  ASSET_REQUEST_ATTACHMENT_KINDS,
  FUEL_REFUND_ATTACHMENT_KINDS,
  FUEL_REQUEST_ATTACHMENT_KINDS,
  formatPeriodMonth,
  mergeRequiredAttachments,
  type FleetQueueRequestType,
} from "./fleet-request-utils";

import { formatKwd } from "./fuel-week";
import type { FleetRequestListRow } from "./fleet-request-types";

const KNOWN_ATTACHMENT_KINDS = new Set<string>([
  ...FUEL_REQUEST_ATTACHMENT_KINDS,
  ...FUEL_REFUND_ATTACHMENT_KINDS,
  ...ASSET_REQUEST_ATTACHMENT_KINDS,
]);

function currentStepAllowedActions(steps: RequestApprovalStep[]): string[] {
  const active = steps.find((step) => step.status === "in_progress");
  return active?.allowed_actions ?? [];
}

export function FleetRequestDialog({
  open,
  type,
  row,
  onOpenChange,
}: {
  open: boolean;
  type: FleetQueueRequestType;
  row: FleetRequestListRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.fleetFuelQueue");
  const requestT = useTranslations("pages.requests");
  const { can } = useAuth();
  const canDecide = can("requests.approve") || can("requests.manage");
  const requestId = row?.id ?? "";
  const { data, isLoading, refetch } = useAdminRequestDetail(requestId);
  const decide = useDecideRequest(requestId);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open || !requestId) return;
    void logAdminRequestDetailOpened(requestId);
  }, [open, requestId]);

  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  if (!row) return null;

  const request = data?.request;
  const steps = data?.steps ?? [];
  const clarifications = data?.clarifications ?? [];
  const attachments = mergeRequiredAttachments(type, data?.attachments ?? []);
  const realAttachmentCount = (data?.attachments ?? []).filter((item) => item.storage_key).length;
  const stepActions = currentStepAllowedActions(steps).filter(
    (action) => action !== "request_documents" || shouldOfferRequestDocumentsAction(realAttachmentCount),
  );
  const decided = request?.completed_at != null;
  const fuelApproveBlocked =
    request != null &&
    isFuelApproveBlocked({
      requestType: request.request_type,
      fuelTransferType: request.fuel_transfer_type,
    });
  const detailRows = request
    ? getTypedFieldRows(request).filter(
        (item) => item.key !== "fuel_transfer_type" && item.key !== "declaration_accepted",
      )
    : [];
  const period =
    request && typeof request.payload.period_month === "string"
      ? formatPeriodMonth(request.payload.period_month)
      : null;
  const summary =
    type === "fuel"
      ? t("summaryRequest", {
          n: row.request_no_this_month,
          period: period ?? "—",
          amount: formatKwd(row.amount_kwd ?? 0),
          company: row.fuel_company ? row.fuel_company.toUpperCase() : "—",
        })
      : type === "fuel_refund"
        ? t("summaryRefund", {
            amount: formatKwd(row.monthly_total_kwd),
            company: row.fuel_company ? row.fuel_company.toUpperCase() : "—",
          })
        : t("summaryAsset", {
            item: row.item ?? "—",
            qty: row.quantity ?? 1,
            had: row.had_before == null ? "—" : row.had_before ? t("hadYes") : t("hadNo"),
          });
  const transferValue = request?.fuel_transfer_type;
  const transferLabel =
    transferValue == null
      ? requestT("detail.fuelTransfer.notSet")
      : requestT(`detail.fuelTransfer.options.${transferValue}` as "detail.fuelTransfer.options.cash");

  const runAction = async (action: string) => {
    const note = reason.trim();
    if (action === "approve" && fuelApproveBlocked) {
      toast.error(requestT("detail.fuelTransfer.requiredBeforeApprove"));
      return;
    }
    if ((action === "reject" || action === "clarify") && !note) {
      toast.error(requestT("detail.reasonRequired"));
      return;
    }
    const result = await decide.mutateAsync({
      action,
      reason: note || undefined,
    });
    if (!result.ok) {
      toast.error(
        result.error === "fuel_transfer_type_required"
          ? requestT("detail.fuelTransfer.requiredBeforeApprove")
          : (result.error ?? requestT("detail.actionFailed")),
      );
      return;
    }
    toast.success(requestT("detail.actionOk"));
    setReason("");
    await refetch();
  };

  const openAttachment = async (storageKey: string) => {
    if (!storageKey) return;
    const result = await fetchRequestAttachmentUrl(storageKey);
    if (!result.url) {
      toast.error(result.error ?? requestT("detail.actionFailed"));
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  const statusPill = (
    <StatusPill
      dot
      className="max-w-full whitespace-normal break-normal"
      variant={requestStatusVariant(row.status, request?.payload)}
    >
      {requestT(`status.${requestStatusLabelKey(row.status, request?.payload)}` as "status.pending")}
    </StatusPill>
  );

  return (
    <FleetRecordDialog
      open={open}
      onOpenChange={onOpenChange}
      footer={
        <AppModalFooter
          title={row.request_code}
          subtitle={`${type === "fuel" ? t("typeFuel") : type === "fuel_refund" ? t("typeRefund") : t("typeAsset")} — ${row.current_step_label ?? "—"}`}
          meta={statusPill}
        >
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </AppModalFooter>
      }
    >
      {isLoading || !request ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <RequesterHeader
              driverId={request.driver_id}
              requestId={request.id}
              requester={request.requester}
            />
          </div>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs font-medium">
            {summary}
          </div>
          <div className="grid gap-2 lg:grid-cols-[1.1fr_0.9fr] lg:items-stretch">
            <div className="flex h-full flex-col gap-2">
              <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <SectionHeading icon={FileText} accent="primary">
                  {requestT("detail.fields")}
                </SectionHeading>
                <div className="mt-1">
                  {detailRows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{requestT("detail.noTypedFields")}</p>
                  ) : (
                    detailRows.map((item) => (
                      <FleetDetailRow key={item.key} label={item.label}>
                        {item.value}
                      </FleetDetailRow>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="min-w-0">
                    <SectionHeading icon={User} accent="primary">
                      {t("sectionEmployee")}
                    </SectionHeading>
                    <div className="mt-1">
                      <FleetDetailRow label={t("colDriver")}>{row.driver_name}</FleetDetailRow>
                      <FleetDetailRow label={t("fieldEmployeeId")}>{row.employee_id ?? "—"}</FleetDetailRow>
                      <FleetDetailRow
                        label={type === "asset" ? t("colEmployeeCompany") : t("colEmpCompany")}
                      >
                        {row.employee_company ?? "—"}
                      </FleetDetailRow>
                      <FleetDetailRow label={t("fieldPhone")}>{row.phone ?? "—"}</FleetDetailRow>
                      <FleetDetailRow label={t("colProject")}>
                        <ProjectBadge value={row.project_key} />
                      </FleetDetailRow>
                      <FleetDetailRow label={t("colZone")}>{row.zone ?? "—"}</FleetDetailRow>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <SectionHeading icon={Car} accent="primary">
                      {t("sectionVehicle")}
                    </SectionHeading>
                    <div className="mt-1">
                      <FleetDetailRow label={t("fieldPlate")}>{row.plate ?? "—"}</FleetDetailRow>
                      <FleetDetailRow label={t("fieldModel")}>{row.vehicle_model ?? "—"}</FleetDetailRow>
                      <FleetDetailRow label={t("colVehicleCompany")}>
                        {row.vehicle_company ?? "—"}
                      </FleetDetailRow>
                      {type === "asset" ? null : (
                        <>
                          <FleetDetailRow label={t("fieldCarType")}>
                            <CarTypeBadge value={row.car_type} />
                          </FleetDetailRow>
                          <FleetDetailRow label={t("colFuelCompany")}>
                            <FuelCompanyBadge value={row.fuel_company} />
                          </FleetDetailRow>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <FleetDetailRow label={t("fieldEvidence")}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {attachments.map((item) => (
                      <FleetAttachmentRow
                        key={item.id}
                        title={
                          item.kind && KNOWN_ATTACHMENT_KINDS.has(item.kind)
                            ? t(`attachment.${item.kind}` as "attachment.odometer")
                            : item.title
                        }
                        fileName={item.file_name}
                        capturedAt={item.captured_at}
                        source={item.source}
                        onOpen={item.storage_key ? () => void openAttachment(item.storage_key) : undefined}
                      />
                    ))}
                  </div>
                </FleetDetailRow>
              </div>
            </div>
            <div className="flex h-full min-w-0 flex-col gap-2">
              <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                <SectionHeading icon={Check} accent="warning">
                  {requestT("detail.approval")}
                </SectionHeading>
                <div className="mt-2">
                  <RequestApprovalTimeline steps={steps} />
                </div>
                {clarifications.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {requestT("detail.clarifications")}
                    </p>
                    {clarifications.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border p-2 text-xs">
                        <p className="font-medium">{item.question}</p>
                        {item.answer ? (
                          <p className="mt-1 text-muted-foreground">{item.answer}</p>
                        ) : (
                          <p className="mt-1 text-warning">{requestT("detail.awaitingAnswer")}</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              {type !== "asset" ? (
                <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                  <FleetDetailRow label={t("fieldTransfer")} muted={transferValue == null}>
                    {transferLabel}
                  </FleetDetailRow>
                  <RequestFuelTransferCard
                    requestId={request.id}
                    value={request.fuel_transfer_type}
                    editable={canDecide && request.status !== "closed"}
                    compact
                  />
                  <FleetDetailRow label={t("colStatus")}>{statusPill}</FleetDetailRow>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                  <FleetDetailRow label={t("colStatus")}>{statusPill}</FleetDetailRow>
                </div>
              )}
              {canDecide && !decided ? (
                <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                  <SectionHeading icon={MessageCircleQuestion} accent="warning">
                    {requestT("detail.actions")}
                  </SectionHeading>
                  <Textarea
                    className="mt-2 min-h-12 text-sm"
                    placeholder={requestT("detail.reasonPlaceholder")}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {stepActions
                      .filter((action) => action !== "reject")
                      .map((action) => (
                        <Button
                          key={action}
                          type="button"
                          className="h-9"
                          disabled={decide.isPending || (action === "approve" && fuelApproveBlocked)}
                          onClick={() => void runAction(action)}
                        >
                          <Check className="me-1.5 h-3.5 w-3.5" />
                          {requestT(`detail.actionLabels.${action}` as "detail.actionLabels.approve")}
                        </Button>
                      ))}
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 text-destructive hover:bg-destructive/10"
                      disabled={decide.isPending}
                      onClick={() => void runAction("reject")}
                    >
                      <X className="me-1.5 h-3.5 w-3.5" />
                      {requestT("detail.reject")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9"
                      disabled={decide.isPending}
                      onClick={() => void runAction("clarify")}
                    >
                      <MessageCircleQuestion className="me-1.5 h-3.5 w-3.5" />
                      {requestT("detail.clarify")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </FleetRecordDialog>
  );
}
