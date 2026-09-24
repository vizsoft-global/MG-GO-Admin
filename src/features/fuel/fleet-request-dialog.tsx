"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, ExternalLink, Loader2, MessageCircleQuestion, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/dashboard/status-pill";
import { SectionHeading } from "@/features/drivers/form/driver-form-primitives";
import { RequestRecordBody } from "@/features/requests/request-record-body";
import { FleetAttachmentRow } from "@/features/fleet/fleet-attachment-row";
import { CarTypeBadge, FuelCompanyBadge, ProjectBadge } from "@/features/fleet/fleet-badges";
import { isDriverProjectKey } from "@/features/fleet/fleet-labels";
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
import { DECISION_TERM_TYPES, type RequestApprovalStep, type RequestListRow } from "@/features/requests/types";
import { useAdminRequestDetail, useDecideRequest } from "@/features/requests/use-requests";
import {
  ASSET_REQUEST_ATTACHMENT_KINDS,
  FUEL_REFUND_ATTACHMENT_KINDS,
  FUEL_REQUEST_ATTACHMENT_KINDS,
  formatPeriodMonth,
  mergeRequiredAttachments,
  FLEET_REQUEST_CHIP_CLASS,
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

const POPUP_DETAIL_ONLY = new Set(["reschedule", "attach_send", "attach_breakdown", "request_documents"]);

export function FleetRequestDialog({
  open,
  type,
  row = null,
  preview = null,
  onOpenChange,
}: {
  open: boolean;
  type?: FleetQueueRequestType;
  row?: FleetRequestListRow | null;
  preview?: RequestListRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.fleetFuelQueue");
  const requestT = useTranslations("pages.requests");
  const { can } = useAuth();
  const canDecide = can("requests.approve") || can("requests.manage");
  const requestId = row?.id ?? preview?.id ?? "";
  const requestType = row?.request_type ?? preview?.request_type ?? type ?? "";
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

  if (!row && !preview) return null;

  const request = data?.request;
  const steps = data?.steps ?? [];
  const fleetType =
    requestType === "fuel" || requestType === "fuel_refund" || requestType === "asset" ? requestType : null;
  const attachments = fleetType
    ? mergeRequiredAttachments(fleetType, data?.attachments ?? [])
    : (data?.attachments ?? []);
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
  const fuelCompanyLabel = row?.fuel_company ? row.fuel_company.toUpperCase() : "—";
  const summary =
    row && requestType === "fuel"
      ? t("summaryRequest", {
          n: row.request_no_this_month,
          period: period ?? "—",
          amount: formatKwd(row.amount_kwd ?? 0),
          company: fuelCompanyLabel,
        })
      : row && requestType === "fuel_refund"
        ? t("summaryRefund", {
            amount: formatKwd(row.monthly_total_kwd),
            company: fuelCompanyLabel,
          })
        : row && requestType === "asset"
          ? t("summaryAsset", {
              item: row.item ?? "—",
              qty: row.quantity ?? 1,
              had: row.had_before == null ? "—" : row.had_before ? t("hadYes") : t("hadNo"),
            })
          : preview?.amount_kwd != null
            ? `${formatKwd(preview.amount_kwd)} KWD`
            : (request?.details ?? "—");
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

  const typeLabel =
    requestType === "fuel"
      ? t("typeFuel")
      : requestType === "fuel_refund"
        ? t("typeRefund")
        : requestType === "asset"
          ? t("typeAsset")
          : requestT(`types.${requestType}` as "types.leave");
  const chipClass =
    requestType === "fuel" || requestType === "fuel_refund" || requestType === "asset"
      ? FLEET_REQUEST_CHIP_CLASS[requestType]
      : "bg-primary/10 text-primary";
  const needsTerms = (DECISION_TERM_TYPES as readonly string[]).includes(requestType);
  const footerActions = stepActions.filter((action) => {
    if (action === "reject" || action === "clarify") return false;
    if (row) return true;
    if (POPUP_DETAIL_ONLY.has(action)) return false;
    if (action === "approve" && needsTerms) return false;
    return true;
  });
  const actionButtons =
    canDecide && !decided ? (
      <>
        {footerActions.map((action) => (
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
      </>
    ) : null;

  const projectSource = row?.project_key ?? preview?.project_key ?? null;
  const projectKey = isDriverProjectKey(projectSource) ? projectSource : null;

  const statusPill = (
    <StatusPill
      dot
      className="max-w-full whitespace-nowrap"
      variant={requestStatusVariant(request?.status ?? row?.status ?? preview?.status ?? "pending", request?.payload)}
    >
      {requestT(
        `status.${requestStatusLabelKey(request?.status ?? row?.status ?? preview?.status ?? "pending", request?.payload)}` as "status.pending",
      )}
    </StatusPill>
  );

  return (
    <FleetRecordDialog
      open={open}
      frame="viewport"
      onOpenChange={onOpenChange}
      footer={
        <AppModalFooter
          title={row?.request_code ?? preview?.request_code ?? ""}
          subtitle={request?.current_step_label ?? row?.current_step_label ?? preview?.current_step_label ?? "—"}
          meta={
            <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${chipClass}`}>
              {typeLabel}
            </span>
          }
        >
          <Link
            href={`/requests/${requestId}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-primary transition-colors duration-150 hover:bg-primary/10"
          >
            <ExternalLink className="size-3.5" />
            {t("viewDetails")}
          </Link>
          {actionButtons}
        </AppModalFooter>
      }
    >
      {isLoading || !request ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <RequestRecordBody
          summary={summary}
          requester={
            <RequesterHeader
              driverId={request.driver_id}
              requestId={request.id}
              requester={request.requester}
            />
          }
          employee={
            <>
              <FleetDetailRow label={t("colDriver")}>
                {row?.driver_name ?? preview?.driver_name ?? request.requester?.name ?? "—"}
              </FleetDetailRow>
              <FleetDetailRow label={t("fieldEmployeeId")}>
                {row?.employee_id ?? preview?.employee_id ?? "—"}
              </FleetDetailRow>
              <FleetDetailRow label={requestType === "asset" ? t("colEmployeeCompany") : t("colEmpCompany")}>
                {row?.employee_company ?? "—"}
              </FleetDetailRow>
              <FleetDetailRow label={t("fieldPhone")}>{row?.phone ?? request.requester?.phone ?? "—"}</FleetDetailRow>
              <FleetDetailRow label={t("colProject")}>
                <ProjectBadge value={projectKey} />
              </FleetDetailRow>
              <FleetDetailRow label={t("colZone")}>{row?.zone ?? preview?.driver_zone ?? request.requester?.zone ?? "—"}</FleetDetailRow>
            </>
          }
          vehicle={
            <>
              <FleetDetailRow label={t("fieldPlate")}>{row?.plate ?? "—"}</FleetDetailRow>
              <FleetDetailRow label={t("fieldModel")}>{row?.vehicle_model ?? "—"}</FleetDetailRow>
              <FleetDetailRow label={t("colVehicleCompany")}>{row?.vehicle_company ?? "—"}</FleetDetailRow>
              {requestType === "fuel" || requestType === "fuel_refund" ? (
                <>
                  <FleetDetailRow label={t("fieldCarType")}>
                    <CarTypeBadge value={row?.car_type ?? null} />
                  </FleetDetailRow>
                  <FleetDetailRow label={t("colFuelCompany")}>
                    <FuelCompanyBadge value={row?.fuel_company ?? null} />
                  </FleetDetailRow>
                </>
              ) : null}
            </>
          }
          fields={
            detailRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">{requestT("detail.noTypedFields")}</p>
            ) : (
              detailRows.map((item) => (
                <FleetDetailRow key={item.key} label={item.label}>
                  {item.value}
                </FleetDetailRow>
              ))
            )
          }
          evidence={
            <div className="grid gap-2 sm:grid-cols-2">
              {attachments.map((item) => (
                <FleetAttachmentRow
                  key={item.id}
                  title={
                    item.kind && KNOWN_ATTACHMENT_KINDS.has(item.kind)
                      ? t(`attachment.${item.kind}` as "attachment.odometer")
                      : (item.title ?? item.file_name ?? "—")
                  }
                  fileName={item.file_name}
                  capturedAt={item.captured_at}
                  source={item.source}
                  onOpen={item.storage_key ? () => void openAttachment(item.storage_key) : undefined}
                />
              ))}
            </div>
          }
          approval={<RequestApprovalTimeline steps={steps} />}
          side={
            <>
              <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                {requestType === "fuel" || requestType === "fuel_refund" ? (
                  <>
                    <FleetDetailRow label={t("paymentMethod")} muted={transferValue == null}>
                      {transferLabel}
                    </FleetDetailRow>
                    <RequestFuelTransferCard
                      requestId={request.id}
                      value={request.fuel_transfer_type}
                      editable={canDecide && request.status !== "closed"}
                      compact
                    />
                  </>
                ) : null}
                <FleetDetailRow label={t("colStatus")}>{statusPill}</FleetDetailRow>
              </div>
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
                </div>
              ) : null}
            </>
          }
        />
      )}
    </FleetRecordDialog>
  );
}
