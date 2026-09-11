"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Car,
  Check,
  FileText,
  Fuel,
  Loader2,
  MessageCircleQuestion,
  User,
  X,
} from "lucide-react";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/dashboard/status-pill";
import { SectionHeading } from "@/features/drivers/form/driver-form-primitives";
import { FleetAttachmentRow } from "@/features/fleet/fleet-attachment-row";
import { CarTypeBadge, FuelCompanyBadge, ProjectBadge } from "@/features/fleet/fleet-badges";
import { useAuth } from "@/contexts/auth-context";
import { RequestApprovalTimeline } from "@/features/requests/request-approval-timeline";
import { RequestFuelTransferCard } from "@/features/requests/request-fuel-transfer-card";
import { RequesterHeader } from "@/features/requests/requester-header";
import {
  fuelFinalApproveBlocked,
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

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3 py-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="min-w-0 text-sm font-medium">{value}</div>
    </div>
  );
}

function currentStepAllowedActions(steps: RequestApprovalStep[]): string[] {
  const active = steps.find((step) => step.status === "in_progress");
  return active?.allowed_actions ?? [];
}

function isFinalApprovalStep(steps: RequestApprovalStep[]): boolean {
  const active = steps.find((step) => step.status === "in_progress");
  if (!active) return true;
  return !steps.some((step) => step.step_order > active.step_order && step.status === "pending");
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
    fuelFinalApproveBlocked({
      requestType: request.request_type,
      fuelTransferType: request.fuel_transfer_type,
      isFinalStep: isFinalApprovalStep(steps),
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        closeOutside
        className="w-[min(1200px,96vw)] overflow-visible px-5 py-4"
      >
        <div className="space-y-2 pt-4">
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
                          <DetailRow key={item.key} label={item.label} value={item.value} />
                        ))
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <SectionHeading icon={User} accent="primary">
                          {t("sectionEmployee")}
                        </SectionHeading>
                        <div className="mt-1">
                          <DetailRow label={t("colDriver")} value={row.driver_name} />
                          <DetailRow label={t("fieldEmployeeId")} value={row.employee_id ?? "—"} />
                          <DetailRow
                            label={type === "asset" ? t("colEmployeeCompany") : t("colEmpCompany")}
                            value={row.employee_company ?? "—"}
                          />
                          <DetailRow label={t("fieldPhone")} value={row.phone ?? "—"} />
                          <DetailRow label={t("colProject")} value={<ProjectBadge value={row.project_key} />} />
                          <DetailRow label={t("colZone")} value={row.zone ?? "—"} />
                        </div>
                      </div>
                      <div>
                        <SectionHeading icon={Car} accent="primary">
                          {t("sectionVehicle")}
                        </SectionHeading>
                        <div className="mt-1">
                          <DetailRow label={t("fieldPlate")} value={row.plate ?? "—"} />
                          <DetailRow label={t("fieldModel")} value={row.vehicle_model ?? "—"} />
                          <DetailRow label={t("colVehicleCompany")} value={row.vehicle_company ?? "—"} />
                          {type === "asset" ? null : (
                            <>
                              <DetailRow label={t("fieldCarType")} value={<CarTypeBadge value={row.car_type} />} />
                              <DetailRow
                                label={t("colFuelCompany")}
                                value={<FuelCompanyBadge value={row.fuel_company} />}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
                    <SectionHeading icon={Fuel} accent="success">
                      {requestT("detail.attachments")}
                    </SectionHeading>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {attachments.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          disabled={!item.storage_key}
                          onClick={() => void openAttachment(item.storage_key)}
                          className="block w-full text-start disabled:cursor-default"
                        >
                          <FleetAttachmentRow
                            title={
                              item.kind && KNOWN_ATTACHMENT_KINDS.has(item.kind)
                                ? t(`attachment.${item.kind}` as "attachment.odometer")
                                : item.title
                            }
                            fileName={item.file_name}
                            capturedAt={item.captured_at}
                            source={item.source}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex h-full flex-col gap-2">
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
                    <RequestFuelTransferCard
                      requestId={request.id}
                      value={request.fuel_transfer_type}
                      editable={canDecide && request.status !== "closed"}
                    />
                  ) : null}
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
        </div>
        <AppModalFooter
          title={row.request_code}
          subtitle={`${type === "fuel" ? t("typeFuel") : type === "fuel_refund" ? t("typeRefund") : t("typeAsset")} — ${row.current_step_label ?? "—"}`}
          meta={
            <StatusPill dot variant={requestStatusVariant(row.status, request?.payload)}>
              {requestT(`status.${requestStatusLabelKey(row.status, request?.payload)}` as "status.pending")}
            </StatusPill>
          }
        >
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
