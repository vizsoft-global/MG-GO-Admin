"use client";

import { useCallback, useEffect, useState, type WheelEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Battery,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Navigation,
  RefreshCw,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { fetchRecentDeliveriesForDriver } from "@/features/deliveries/deliveries-actions";
import { fetchDriverAssignedRestaurantPins } from "@/features/locations/locations-actions";
import { DriverOperationTimeline } from "@/features/live-tracking/driver-operation-timeline";
import {
  liveOrderDisplayId,
  liveOrderTimestamp,
  liveRecentOrderDisplayStatus,
} from "@/features/live-tracking/live-recent-orders";
import {
  formatAccuracyMeters,
  formatBatteryLevel,
  formatDurationSince,
} from "@/features/live-tracking/tracking-metrics";
import { avatarTintFromName } from "@/features/drivers/form/driver-form-primitives";
import { Link, useRouter } from "@/i18n/navigation";
import { queryKeys } from "@/lib/query/query-keys";
import { cn } from "@/lib/utils";

import { displaySpeedKmh, fleetStatusTone, hasLiveTelemetry } from "./fleet-status";
import { FLEET_TONE_BADGE, FLEET_TONE_DOT } from "./fleet-tone";
import { useFleetDriver } from "./use-fleet";

function stopWheelFromReachingMap(event: WheelEvent) {
  event.stopPropagation();
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function FleetDriverDetails({
  driverId,
  collapsed,
  onCollapsedChange,
  onBack,
}: {
  driverId: string;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  onBack: () => void;
}) {
  const t = useTranslations("pages.liveTrackingV2");
  const { can } = useAuth();
  const router = useRouter();
  const driver = useFleetDriver(driverId);
  const canViewActivity = can("driver_ops.view");
  const [address, setAddress] = useState<string | null>(null);
  const [addressState, setAddressState] = useState<"idle" | "loading" | "done">("idle");
  const [refreshSeq, setRefreshSeq] = useState(0);

  const live = driver ? hasLiveTelemetry(driver.status) : false;
  const lat = driver?.lat ?? null;
  const lng = driver?.lng ?? null;
  const hasFix = lat != null && lng != null;

  const lookupAddress = useCallback(() => {
    if (!hasFix || lat == null || lng == null) {
      setAddress(null);
      setAddressState("done");
      return;
    }
    const geocoder = window.google?.maps?.Geocoder
      ? new window.google.maps.Geocoder()
      : null;
    if (!geocoder) {
      setAddress(null);
      setAddressState("done");
      return;
    }
    setAddressState("loading");
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (status === "OK" && results?.[0]?.formatted_address) {
        setAddress(results[0].formatted_address);
      } else {
        setAddress(null);
      }
      setAddressState("done");
    });
  }, [hasFix, lat, lng]);

  useEffect(() => {
    setAddress(null);
    setAddressState("idle");
    lookupAddress();
  }, [driverId, lookupAddress, refreshSeq]);

  const { data: restaurantPins = [] } = useQuery({
    queryKey: queryKeys.liveTracking.restaurantPins(driverId),
    queryFn: () => fetchDriverAssignedRestaurantPins(driverId),
    enabled: Boolean(driverId),
  });

  const { data: recentOrders = [] } = useQuery({
    queryKey: ["live-tracking", "recent-deliveries", driverId],
    queryFn: async () => {
      try {
        const rows = await fetchRecentDeliveriesForDriver(driverId, 3);
        return rows.map((row) => ({
          id: row.id,
          shortId: liveOrderDisplayId(row),
          status: row.status,
          partnerName: row.partner_name,
          deliveredAt: liveOrderTimestamp(row),
        }));
      } catch {
        return [];
      }
    },
    enabled: Boolean(driverId),
    refetchInterval: 10_000,
  });

  if (collapsed) {
    return (
      <div className="fleet-overlay pointer-events-auto flex h-auto w-12 shrink-0 flex-col items-center gap-1.5 self-start rounded-xl border p-1.5 shadow-sm">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={t("insights.expand")}
          onClick={() => onCollapsedChange?.(false)}
        >
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
        </Button>
        <UserRound className="size-3.5 text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (!driver) return null;

  const { meta } = driver;
  const name = meta.driverName || meta.driverCode || driverId;
  const statusTone = fleetStatusTone(driver.status);
  const speedLabel = live ? `${displaySpeedKmh(driver.speedMps, undefined, driver.status)} km/h` : "—";
  const accuracyLabel = live ? formatAccuracyMeters(meta.accuracyMeters) : "—";
  const lastGps =
    driver.fixAtMs > 0 ? formatDurationSince(new Date(driver.fixAtMs).toISOString()) : "—";
  const locationLabel = address
    ? address
    : hasFix
      ? formatCoords(lat, lng)
      : "—";
  const restaurantNames =
    restaurantPins.length > 0
      ? restaurantPins
      : meta.restaurantName
        ? [{ id: "meta", name: meta.restaurantName }]
        : [];

  return (
    <div
      className="fleet-overlay pointer-events-auto flex h-full min-h-0 w-[340px] flex-col rounded-xl border shadow-sm"
      onWheel={stopWheelFromReachingMap}
    >
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/60 px-2">
        <Button
          type="button"
          variant="ghost"
          className="h-8 px-2 text-xs"
          onClick={onBack}
        >
          <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
          {t("details.back")}
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{t("details.heading")}</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={t("insights.collapse")}
          onClick={() => onCollapsedChange?.(true)}
        >
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-start gap-2 border-b border-border/60 px-2 py-2">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
              avatarTintFromName(name),
            )}
            aria-hidden
          >
            {initials(name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 truncate text-xs font-semibold">{name}</p>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                  FLEET_TONE_BADGE[statusTone],
                )}
              >
                <span className={cn("size-1.5 rounded-full", FLEET_TONE_DOT[statusTone])} aria-hidden />
                {t(`status.${driver.status}`)}
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[10px] text-primary">{meta.driverCode}</p>
          </div>
        </div>

        <section className="space-y-1.5 border-b border-border/60 px-2 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("details.location")}
            </p>
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-8 px-0"
              aria-label={t("details.refreshLocation")}
              disabled={!hasFix || addressState === "loading"}
              onClick={() => setRefreshSeq((n) => n + 1)}
            >
              <RefreshCw className="size-3.5" aria-hidden />
            </Button>
          </div>
          <p className="text-[11px] leading-snug">{locationLabel}</p>
          <p className="text-[10px] text-muted-foreground">
            {t("rail.zone")}: {meta.currentZoneName ?? meta.zoneName ?? t("rail.noZone")}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {t("details.plate")}: {meta.vehicleLabel ?? "—"}
          </p>
        </section>

        <section className="grid grid-cols-2 gap-1.5 border-b border-border/60 px-2 py-2">
          <Stat icon={<Navigation className="size-3" aria-hidden />} label={t("details.speed")} value={speedLabel} />
          <Stat
            icon={<Battery className="size-3" aria-hidden />}
            label={t("details.battery")}
            value={formatBatteryLevel(meta.batteryPct)}
          />
          <Stat label={t("details.accuracy")} value={accuracyLabel} />
          <Stat label={t("details.lastGps")} value={lastGps} />
        </section>

        <section className="border-b border-border/60 px-2 py-2">
          <h4 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold">
            <MapPin className="size-3" aria-hidden />
            {t("details.assignedRestaurants")}
          </h4>
          {restaurantNames.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">{t("details.noRestaurants")}</p>
          ) : (
            <ul className="space-y-1">
              {restaurantNames.map((pin) => (
                <li key={pin.id}>
                  {pin.id === "meta" ? (
                    <span className="text-[11px]">{pin.name}</span>
                  ) : (
                    <Link
                      href={`/restaurants/${pin.id}`}
                      className="block truncate text-[11px] text-primary hover:bg-primary/10"
                    >
                      {pin.name}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border-b border-border/60 px-2 py-2">
          <h4 className="mb-1.5 text-[11px] font-semibold">{t("details.recentOrders")}</h4>
          {recentOrders.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">{t("details.noRecentOrders")}</p>
          ) : (
            <ul className="space-y-1.5">
              {recentOrders.map((order) => {
                const display = liveRecentOrderDisplayStatus({
                  status: order.status,
                  deliveredAt: order.deliveredAt,
                });
                return (
                  <li key={order.id} className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold">#{order.shortId}</p>
                      <span className="text-[10px] font-semibold text-muted-foreground">
                        {t(`details.orderStatus.${display}`)}
                      </span>
                    </div>
                    <p className="truncate text-[10px] text-muted-foreground">{order.partnerName ?? "—"}</p>
                    <p className="text-[10px] text-muted-foreground">{formatDurationSince(order.deliveredAt)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {canViewActivity ? (
          <DriverOperationTimeline
            driverId={driverId}
            limit={4}
            onViewAll={() =>
              router.push(`/drivers/${driverId}?tab=activity&from=live-tracking-v2`)
            }
            className="rounded-none border-0 bg-transparent px-2 py-2"
          />
        ) : null}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-muted/30 px-1.5 py-1">
      <p className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </p>
      <p className="truncate text-[11px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}
