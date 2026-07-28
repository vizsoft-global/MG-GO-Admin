"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileImage,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { hasPermissionInSet } from "@/lib/auth/permissions";
import { proofFilenameFromKey } from "@/lib/storage/order-proof-url";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/dashboard/status-pill";
import { cn } from "@/lib/utils";
import { selectOptionsFrom } from "@/lib/select-items";
import { queryKeys } from "@/lib/query/query-keys";
import { useRealtimeInvalidator } from "@/lib/realtime/use-realtime-invalidator";
import { DeliveryGpsAuditPanel } from "./delivery-gps-audit-panel";
import {
  DeliveryLocationMap,
  deliveryMapPointsFromRow,
} from "./delivery-location-map";
import {
  fetchLiveDriverLocationForDelivery,
} from "./deliveries-actions";
import {
  cancelReasonMessageKey,
  parseCancelReason,
} from "./parse-cancel-reason";
import { useDeleteDelivery, useUpdateDeliveryStatus } from "./use-deliveries";
import { resolveStatusVariant } from "@/lib/ui/resolve-status-variant";
import type { DeliveryListRow, DeliveryMapPoint, DeliveryStatus } from "./types";
import { REVIEWABLE_DELIVERY_STATUSES, type ReviewableDeliveryStatus } from "./types";

function statusMessageKey(status: DeliveryStatus) {
  switch (status) {
    case "verified":
      return "statusVerified";
    case "rejected":
      return "statusRejected";
    case "under_review":
      return "statusUnderReview";
    case "in_transit":
      return "statusInTransit";
    case "cancelled":
      return "statusCancelled";
    case "pending":
    default:
      return "statusPending";
  }
}

function formatDateTime(iso: string, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale ?? "en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kuwait",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatCoords(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return "—";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border py-2.5 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-end text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}


async function fetchDeliveryGpsFromApi(
  deliveryId: string,
): Promise<{ gpsEvent: import("@/features/locations/types").DriverLocationEvent | null }> {
  const res = await fetch(`/api/deliveries/${deliveryId}/gps`, {
    credentials: "same-origin",
  });
  if (res.status === 403) throw new Error("not_authorized");
  if (!res.ok) throw new Error("gps_failed");
  return res.json();
}

function DeliveryProofColumn({
  objectKey,
  contentTypeHint,
  sectionLabel,
  thumbUrl,
  fullUrl,
  showBorderRight = false,
}: {
  objectKey: string | null;
  contentTypeHint: string | null;
  sectionLabel: string;
  thumbUrl: string | null | undefined;
  fullUrl: string | null | undefined;
  showBorderRight?: boolean;
}) {
  const t = useTranslations("pages.deliveries");
  const [imgError, setImgError] = useState(false);

  const trimmedKey = objectKey?.trim() ?? "";
  const displayUrl = thumbUrl ?? fullUrl ?? null;
  const openUrl = fullUrl ?? thumbUrl ?? null;
  const contentType = contentTypeHint;

  useEffect(() => {
    setImgError(false);
  }, [trimmedKey, displayUrl]);

  const filename = proofFilenameFromKey(objectKey) ?? t("proofImage");
  const isImage = contentType?.startsWith("image/") || (!contentType && displayUrl);
  const isPdf = contentType === "application/pdf";

  const actionButtons =
    openUrl && trimmedKey ? (
      <div className="flex shrink-0 gap-1">
        <Button
          variant="outline"
          size="icon-lg"
          className="shrink-0 cursor-pointer rounded-lg"
          render={
            <a
              href={openUrl}
              download={filename}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("proofDownload")}
            />
          }
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          className="shrink-0 cursor-pointer rounded-lg text-primary hover:bg-primary/10"
          render={
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("proofOpenNew")}
            />
          }
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
    ) : null;

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        showBorderRight && "border-r border-border",
      )}
    >
      <div className="flex min-h-[3.25rem] shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2">
        <p className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {sectionLabel}
        </p>
        {actionButtons}
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-zinc-950 p-3">
        {!trimmedKey ? (
          <div className="flex flex-col items-center gap-1 text-center">
            <FileImage className="h-7 w-7 text-muted-foreground/50" />
            <p className="text-[11px] text-muted-foreground">{t("proofUnavailable")}</p>
          </div>
        ) : !displayUrl ? (
          <div className="flex flex-col items-center gap-1 text-center">
            <FileImage className="h-7 w-7 text-muted-foreground/50" />
            <p className="text-[11px] text-muted-foreground">{t("proofUnavailable")}</p>
          </div>
        ) : isPdf ? (
          <a
            href={openUrl ?? displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1 text-center"
            aria-label={t("proofOpenNew")}
          >
            <FileImage className="h-7 w-7 text-muted-foreground/60" />
            <p className="text-[11px] text-muted-foreground">{t("proofPdf")}</p>
          </a>
        ) : isImage && !imgError ? (
          <a
            href={openUrl ?? displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="relative flex h-full w-full max-h-48 cursor-pointer items-center justify-center"
            aria-label={t("proofOpenNew")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayUrl}
              alt={sectionLabel}
              loading="eager"
              decoding="async"
              className="max-h-48 max-w-full rounded-md object-contain shadow-sm"
              onError={() => setImgError(true)}
            />
          </a>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-[11px] text-muted-foreground">
              {imgError ? t("proofExpired") : t("proofUnavailable")}
            </p>
            {imgError ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 cursor-pointer rounded-lg px-2 text-[11px]"
                onClick={() => setImgError(false)}
              >
                <RefreshCw className="me-1 h-3 w-3" />
                {t("proofRetry")}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function DeliveryProofSplitView({ delivery }: { delivery: DeliveryListRow }) {
  const t = useTranslations("pages.deliveries");

  const rightProof = delivery.cancel_proof_url
    ? {
        type: delivery.cancel_proof_content_type,
        key: delivery.cancel_proof_url,
        thumb: delivery.cancel_proof_display_url,
        full: delivery.cancel_proof_full_url,
        label: t("cancelProof"),
      }
    : {
        type: delivery.proof_content_type,
        key: delivery.order_proof_url,
        thumb: delivery.proof_display_url,
        full: delivery.proof_full_url,
        label: t("sectionProof"),
      };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 border-b border-border">
      <DeliveryProofColumn
        objectKey={delivery.pickup_proof_url}
        contentTypeHint={delivery.pickup_proof_content_type}
        sectionLabel={t("pickupProof")}
        thumbUrl={delivery.pickup_proof_display_url}
        fullUrl={delivery.pickup_proof_full_url}
        showBorderRight
      />
      <DeliveryProofColumn
        objectKey={rightProof.key}
        contentTypeHint={rightProof.type}
        sectionLabel={rightProof.label}
        thumbUrl={rightProof.thumb}
        fullUrl={rightProof.full}
      />
    </div>
  );
}

export type DeliveryDetailNavigation = {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  isLoadingNext?: boolean;
  positionLabel?: string;
};

export function DeliveryDetailSheet({
  delivery,
  open,
  onClose,
  onUpdated,
  navigation,
}: {
  delivery: DeliveryListRow | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
  navigation?: DeliveryDetailNavigation;
}) {
  const t = useTranslations("pages.deliveries");
  const { permissions, isSuperAdmin } = useAuth();
  const canManage = hasPermissionInSet(
    new Set(permissions),
    "deliveries.manage",
    isSuperAdmin,
  );

  const statusMutation = useUpdateDeliveryStatus();
  const deleteMutation = useDeleteDelivery();

  const [statusDraft, setStatusDraft] = useState<ReviewableDeliveryStatus>("pending");
  const [rejectReason, setRejectReason] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isInTransit = delivery?.status === "in_transit";

  const {
    data: gpsAudit,
    isLoading: gpsAuditLoading,
  } = useQuery({
    queryKey: queryKeys.deliveries.gpsAudit(delivery?.id ?? ""),
    queryFn: () => fetchDeliveryGpsFromApi(delivery!.id),
    enabled: open && Boolean(delivery?.id),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  useRealtimeInvalidator({
    channel: `admin-delivery-live-${delivery?.id ?? "none"}`,
    tables: [
      {
        table: "driver_locations",
        filter: delivery?.id ? `active_delivery_id=eq.${delivery.id}` : undefined,
      },
    ],
    invalidateKeys: [queryKeys.deliveries.deliveryLiveLocation(delivery?.id ?? "")],
    enabled: open && isInTransit && Boolean(delivery?.id),
  });

  const { data: liveLocation } = useQuery({
    queryKey: queryKeys.deliveries.deliveryLiveLocation(delivery?.id ?? ""),
    queryFn: () =>
      fetchLiveDriverLocationForDelivery(delivery!.id, delivery!.driver_id),
    enabled: open && isInTransit && Boolean(delivery?.id),
    refetchInterval: isInTransit ? 15_000 : false,
  });

  useEffect(() => {
    if (!delivery || !open) return;
    const reviewable = REVIEWABLE_DELIVERY_STATUSES.includes(
      delivery.status as ReviewableDeliveryStatus,
    )
      ? (delivery.status as ReviewableDeliveryStatus)
      : "pending";
    setStatusDraft(reviewable);
    setRejectReason(delivery.rejection_reason ?? "");
  }, [delivery, open]);

  useEffect(() => {
    if (!open || !navigation) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [role='combobox']",
        )
      ) {
        return;
      }
      if (deleteOpen) return;
      if (event.key === "ArrowLeft" && navigation.hasPrevious) {
        event.preventDefault();
        navigation.onPrevious();
      }
      if (
        event.key === "ArrowRight" &&
        navigation.hasNext &&
        !navigation.isLoadingNext
      ) {
        event.preventDefault();
        navigation.onNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, navigation, deleteOpen]);

  const statusSelectItems = useMemo(
    () =>
      selectOptionsFrom(REVIEWABLE_DELIVERY_STATUSES, (status) => status, (status) =>
        t(statusMessageKey(status)),
      ),
    [t],
  );

  const mapPoints = useMemo((): DeliveryMapPoint[] => {
    if (!delivery) return [];
    const points = deliveryMapPointsFromRow(delivery);
    if (isInTransit && liveLocation) {
      points.push({
        lat: liveLocation.latitude,
        lng: liveLocation.longitude,
        kind: "live",
      });
    }
    return points;
  }, [delivery, isInTransit, liveLocation]);

  if (!delivery) return null;

  const parsedCancel = parseCancelReason(delivery.cancel_reason);
  const isReadOnlyStatus =
    delivery.status === "in_transit" || delivery.status === "cancelled";
  const statusLabel = t(statusMessageKey(delivery.status));
  const isBusy = statusMutation.isPending || deleteMutation.isPending;

  const statusUnchanged = statusDraft === delivery.status;
  const rejectReasonUnchanged =
    statusDraft !== "rejected" ||
    rejectReason.trim() === (delivery.rejection_reason ?? "").trim();
  const canSaveStatus =
    canManage &&
    !isReadOnlyStatus &&
    (!statusUnchanged ||
      (statusDraft === "rejected" && !rejectReasonUnchanged));

  const handleSaveStatus = async () => {
    if (!canManage) {
      toast.error(t("noPermission"));
      return;
    }
    if (statusDraft === "rejected" && !rejectReason.trim()) {
      toast.error(t("rejectReasonRequired"));
      return;
    }
    const result = await statusMutation.mutateAsync({
      deliveryId: delivery.id,
      status: statusDraft,
      rejectionReason: statusDraft === "rejected" ? rejectReason : undefined,
    });
    if ("error" in result) {
      const msg =
        result.error === "reason_required"
          ? t("rejectReasonRequired")
          : result.error === "invalid_status"
            ? t("invalidStatusChange")
          : result.error === "not_authorized"
            ? t("noPermission")
            : t("statusChangeFailed");
      toast.error(msg, {
        description: result.errorDetail,
        duration: result.errorDetail ? 9000 : undefined,
      });
      return;
    }
    toast.success(t("statusChangeSuccess"));
    onUpdated?.();
    onClose();
  };

  const handleDelete = async () => {
    const result = await deleteMutation.mutateAsync(delivery.id);
    if ("error" in result) {
      toast.error(
        result.error === "not_authorized" ? t("noPermission") : t("deleteFailed"),
        {
          description: result.errorDetail,
          duration: result.errorDetail ? 9000 : undefined,
        },
      );
      return;
    }
    toast.success(t("deleteSuccess"));
    setDeleteOpen(false);
    onUpdated?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton
        closeOutside
        closeButtonClassName="-top-6"
        className="flex h-[min(90vh,820px)] flex-col gap-0 p-0 sm:max-w-5xl"
      >
        {navigation ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className={cn(
                "pointer-events-auto absolute top-1/2 z-[1102] start-2 size-9 -translate-y-1/2 cursor-pointer rounded-full border border-border bg-background/95 shadow-md backdrop-blur-sm active:!translate-y-[-50%]",
                (!navigation.hasPrevious || isBusy) && "opacity-50",
              )}
              onClick={navigation.onPrevious}
              disabled={!navigation.hasPrevious || isBusy}
              aria-label={t("detailPrevious")}
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className={cn(
                "pointer-events-auto absolute top-1/2 z-[1102] end-2 size-9 -translate-y-1/2 cursor-pointer rounded-full border border-border bg-background/95 shadow-md backdrop-blur-sm active:!translate-y-[-50%]",
                (!navigation.hasNext || navigation.isLoadingNext || isBusy) && "opacity-50",
              )}
              onClick={navigation.onNext}
              disabled={
                !navigation.hasNext || navigation.isLoadingNext || isBusy
              }
              aria-label={t("detailNext")}
            >
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </Button>
          </>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="order-2 flex min-h-0 w-full shrink-0 flex-col lg:order-1 lg:w-[min(420px,42%)] lg:max-w-[420px]">
            <div className="flex-1 space-y-5 overflow-y-auto px-6 pt-4 pb-4">
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("sectionDelivery")}
                </h4>
                <dl className="rounded-lg border border-border px-3">
                  <DetailRow label={t("colDeliveryId")} value={`#${delivery.short_id}`} />
                  <DetailRow
                    label={t("colStatus")}
                    value={
                      <StatusPill variant={resolveStatusVariant(delivery.status)} dot>
                        {statusLabel}
                      </StatusPill>
                    }
                  />
                  {delivery.external_order_id ? (
                    <DetailRow
                      label={t("colOrderId")}
                      value={
                        <span className="font-mono tabular-nums">
                          {delivery.external_order_id}
                        </span>
                      }
                    />
                  ) : null}
                  <DetailRow
                    label={t("colRestaurant")}
                    value={
                      delivery.restaurant_name ? (
                        delivery.restaurant_name
                      ) : (
                        <span className="text-muted-foreground">{t("restaurantNotAssigned")}</span>
                      )
                    }
                  />
                  {delivery.rejection_reason ? (
                    <DetailRow
                      label={t("rejectionReason")}
                      value={
                        <span className="max-w-[200px] text-end text-destructive">
                          {delivery.rejection_reason}
                        </span>
                      }
                    />
                  ) : null}
                </dl>
              </section>

              {delivery.pickup_at ? (
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("sectionPickup")}
                  </h4>
                  <dl className="rounded-lg border border-border px-3">
                    <DetailRow
                      label={t("pickupAt")}
                      value={formatDateTime(delivery.pickup_at)}
                    />
                    <DetailRow
                      label={t("pickupCoords")}
                      value={
                        <span className="font-mono text-xs">
                          {formatCoords(delivery.pickup_lat, delivery.pickup_lng)}
                        </span>
                      }
                    />
                  </dl>
                </section>
              ) : null}

              {delivery.delivered_at ? (
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("sectionDeliveryFinish")}
                  </h4>
                  <dl className="rounded-lg border border-border px-3">
                    <DetailRow
                      label={t("colDeliveredAt")}
                      value={formatDateTime(delivery.delivered_at)}
                    />
                    <DetailRow
                      label={t("deliveryCoords")}
                      value={
                        <span className="font-mono text-xs">
                          {formatCoords(delivery.delivered_lat, delivery.delivered_lng)}
                        </span>
                      }
                    />
                  </dl>
                </section>
              ) : null}

              {delivery.cancelled_at ? (
                <section>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("sectionCancellation")}
                  </h4>
                  <dl className="rounded-lg border border-border px-3">
                    <DetailRow
                      label={t("cancelledAt")}
                      value={formatDateTime(delivery.cancelled_at)}
                    />
                    <DetailRow
                      label={t("cancelCoords")}
                      value={
                        <span className="font-mono text-xs">
                          {formatCoords(delivery.cancel_lat, delivery.cancel_lng)}
                        </span>
                      }
                    />
                    {parsedCancel ? (
                      <>
                        <DetailRow
                          label={t("cancelReasonLabel")}
                          value={
                            <StatusPill variant="danger">
                              {t(cancelReasonMessageKey(parsedCancel.code))}
                            </StatusPill>
                          }
                        />
                        {parsedCancel.note ? (
                          <DetailRow
                            label={t("cancelReasonNote")}
                            value={
                              <span className="max-w-[200px] text-end text-sm">
                                {parsedCancel.note}
                              </span>
                            }
                          />
                        ) : null}
                      </>
                    ) : null}
                  </dl>
                </section>
              ) : null}

              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("sectionDriver")}
                </h4>
                <dl className="rounded-lg border border-border px-3">
                  <DetailRow label={t("driverName")} value={delivery.driver_name} />
                  <DetailRow
                    label={t("driverCode")}
                    value={
                      <span className="font-mono tabular-nums">#{delivery.driver_code}</span>
                    }
                  />
                  <DetailRow
                    label={t("driverPhone")}
                    value={
                      delivery.driver_phone !== "—" ? (
                        <a
                          href={`tel:${delivery.driver_phone}`}
                          className="text-primary hover:underline"
                        >
                          {delivery.driver_phone}
                        </a>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <DetailRow label={t("colZone")} value={delivery.zone_name} />
                </dl>
              </section>

              {canManage && !isReadOnlyStatus ? (
                <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("changeStatus")}
                  </h4>
                  <div className="space-y-1.5">
                    <Label htmlFor="delivery-status-select" className="text-sm">
                      {t("colStatus")}
                    </Label>
                    <Select
                      items={statusSelectItems}
                      value={statusDraft}
                      onValueChange={(v) =>
                        setStatusDraft(v as ReviewableDeliveryStatus)
                      }
                    >
                      <SelectTrigger
                        id="delivery-status-select"
                        className="w-full cursor-pointer rounded-lg"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REVIEWABLE_DELIVERY_STATUSES.map((status) => (
                          <SelectItem
                            key={status}
                            value={status}
                            label={t(statusMessageKey(status))}
                          >
                            {t(statusMessageKey(status))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {statusDraft === "rejected" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="reject-reason" className="text-sm text-destructive">
                        {t("rejectReasonLabel")}
                      </Label>
                      <Textarea
                        id="reject-reason"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder={t("rejectReasonLabel")}
                        rows={3}
                        className="resize-none"
                      />
                    </div>
                  ) : null}
                </section>
              ) : isReadOnlyStatus ? (
                <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  {t("readOnlyStatusHint")}
                </p>
              ) : null}
            </div>

            {canManage || isSuperAdmin ? (
              <AppModalFooter
                title={t("detailTitle")}
                subtitle={`#${delivery.short_id}`}
                meta={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <StatusPill variant={resolveStatusVariant(delivery.status)} dot>
                      {statusLabel}
                    </StatusPill>
                    {navigation?.positionLabel ? (
                      <span className="tabular-nums">{navigation.positionLabel}</span>
                    ) : null}
                  </span>
                }
              >
                {isSuperAdmin ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 cursor-pointer rounded-lg border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteOpen(true)}
                    disabled={isBusy}
                  >
                    <Trash2 className="me-2 h-3.5 w-3.5" />
                    {t("deleteDelivery")}
                  </Button>
                ) : null}
                {canManage && !isReadOnlyStatus ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 cursor-pointer rounded-lg"
                    onClick={() => void handleSaveStatus()}
                    disabled={
                      isBusy ||
                      !canSaveStatus ||
                      (statusDraft === "rejected" && !rejectReason.trim())
                    }
                  >
                    {statusMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t("saveStatus")
                    )}
                  </Button>
                ) : null}
              </AppModalFooter>
            ) : null}
          </div>

          <div
            className={cn(
              "order-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-border lg:order-2 lg:min-h-0 lg:border-b-0 lg:border-l",
            )}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <DeliveryProofSplitView delivery={delivery} />
              <div className="grid max-h-[min(42vh,360px)] shrink-0 gap-3 overflow-hidden border-t border-border p-4 md:grid-cols-2">
                <div className="min-h-0 overflow-y-auto">
                  <DeliveryGpsAuditPanel
                    event={gpsAudit?.gpsEvent}
                    isLoading={gpsAuditLoading}
                    pickupLat={delivery.pickup_lat}
                    pickupLng={delivery.pickup_lng}
                    deliveredLat={delivery.delivered_lat}
                    deliveredLng={delivery.delivered_lng}
                    cancelLat={delivery.cancel_lat}
                    cancelLng={delivery.cancel_lng}
                  />
                </div>
                <div className="min-h-0 overflow-hidden">
                  {mapPoints.length > 0 ? (
                    <DeliveryLocationMap
                      points={mapPoints}
                      mapHeightClass="h-40 md:h-48"
                      expandable
                    />
                  ) : (
                    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground md:h-48">
                      {t("locationUnavailable")}
                    </div>
                  )}
                </div>
              </div>
              {isInTransit && liveLocation ? (
                <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
                  {t("liveLocationUpdated", {
                    time: formatDateTime(liveLocation.lastSeenAt),
                  })}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        itemTitle={t("deleteDeliveryTitle")}
        itemName={`#${delivery.short_id}`}
        confirmText={delivery.short_id}
        warning={t("deleteDeliveryWarning")}
        onConfirm={handleDelete}
        isPending={deleteMutation.isPending}
      />
    </Dialog>
  );
}
