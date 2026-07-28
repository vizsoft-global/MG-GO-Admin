"use client";

import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { StatusPill } from "@/components/dashboard/status-pill";
import { haversineMeters } from "@/features/locations/location-status";
import type { DriverLocationEvent } from "@/features/locations/types";
import { cn } from "@/lib/utils";

function formatCoords(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return "—";
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function CoordRow({ label, lat, lng }: { label: string; lat: number | null; lng: number | null }) {
  if (lat == null || lng == null) return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{formatCoords(lat, lng)}</dd>
    </div>
  );
}

export function DeliveryGpsAuditPanel({
  event,
  isLoading,
  pickupLat,
  pickupLng,
  deliveredLat,
  deliveredLng,
  cancelLat,
  cancelLng,
  className,
}: {
  event: DriverLocationEvent | null | undefined;
  isLoading: boolean;
  pickupLat: number | null;
  pickupLng: number | null;
  deliveredLat: number | null;
  deliveredLng: number | null;
  cancelLat?: number | null;
  cancelLng?: number | null;
  className?: string;
}) {
  const t = useTranslations("pages.deliveries.gpsAudit");

  const hasPickup = pickupLat != null && pickupLng != null;
  const hasDelivered = deliveredLat != null && deliveredLng != null;
  const hasCancel = cancelLat != null && cancelLng != null;
  const hasRecordCoords = hasPickup || hasDelivered || hasCancel;

  const referenceLat = deliveredLat ?? cancelLat ?? null;
  const referenceLng = deliveredLng ?? cancelLng ?? null;

  const divergenceM =
    event && referenceLat != null && referenceLng != null
      ? haversineMeters(event.latitude, event.longitude, referenceLat, referenceLng)
      : null;

  const diverged = divergenceM != null && divergenceM > 50;
  const showMockBadge = event?.isMocked === true;

  if (!hasRecordCoords && !event && !isLoading) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-muted/20 px-4 py-3",
        className,
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("title")}
        </p>
        {isLoading ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {t("loading")}
          </span>
        ) : showMockBadge ? (
          <StatusPill variant="danger">{t("mockLocation")}</StatusPill>
        ) : event && referenceLat != null && referenceLng != null ? (
          diverged ? (
            <StatusPill variant="danger">{t("divergenceWarning")}</StatusPill>
          ) : (
            <StatusPill variant="success">{t("coordsMatch")}</StatusPill>
          )
        ) : !event && hasRecordCoords ? (
          <StatusPill variant="warning">{t("noTrackingEvent")}</StatusPill>
        ) : null}
      </div>
      <dl className="space-y-1 text-xs">
        <CoordRow label={t("pickupCoords")} lat={pickupLat} lng={pickupLng} />
        {hasDelivered ? (
          <CoordRow label={t("deliveryCoords")} lat={deliveredLat} lng={deliveredLng} />
        ) : hasCancel ? (
          <CoordRow label={t("deliveryCoords")} lat={cancelLat ?? null} lng={cancelLng ?? null} />
        ) : null}
        {event ? (
          <CoordRow label={t("trackingCoords")} lat={event.latitude} lng={event.longitude} />
        ) : null}
        {divergenceM != null ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("divergence")}</dt>
            <dd>{Math.round(divergenceM)} m</dd>
          </div>
        ) : null}
        {event ? (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("accuracy")}</dt>
              <dd>
                {event.accuracyMeters != null ? `${Math.round(event.accuracyMeters)} m` : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("battery")}</dt>
              <dd>{event.batteryPct != null ? `${event.batteryPct}%` : "—"}</dd>
            </div>
            {event.headingDeg != null ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("heading")}</dt>
                <dd>{Math.round(event.headingDeg)}°</dd>
              </div>
            ) : null}
            {event.altitudeM != null ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("altitude")}</dt>
                <dd>{Math.round(event.altitudeM)} m</dd>
              </div>
            ) : null}
            {event.networkType ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("network")}</dt>
                <dd>{event.networkType}</dd>
              </div>
            ) : null}
            {event.chargingState ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("charging")}</dt>
                <dd>{event.chargingState}</dd>
              </div>
            ) : null}
            {event.locationProvider ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t("provider")}</dt>
                <dd>{event.locationProvider}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t("zoneAtSubmit")}</dt>
              <dd>{event.zoneStatus ?? "—"}</dd>
            </div>
          </>
        ) : null}
      </dl>
    </div>
  );
}
