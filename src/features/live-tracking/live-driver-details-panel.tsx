"use client";

import { useTranslations } from "next-intl";
import { Bike, Package, Phone, X, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Pill, SignalBars, StatusDot, type Tone } from "@/components/ui/metric-tile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link } from "@/i18n/navigation";
import { avatarTintFromName } from "@/features/drivers/form/driver-form-primitives";
import type { DriverLiveLocation } from "@/features/locations/types";
import { isGpsLive } from "@/features/locations/location-status";
import { formatDistanceMeters } from "@/features/locations/location-status";
import {
  formatAccuracyMeters,
  formatBatteryLevel,
  formatDurationSince,
  formatSpeedKmh,
  driverInitials,
  gpsQualityFromAccuracy,
} from "./tracking-metrics";
import { TrackingGlassCard } from "./tracking-shell";
import type { LiveDriverMeta, LiveRecentDelivery } from "./live-tracking-types";
import { cn } from "@/lib/utils";

export function LiveDriverDetailsPanel({
  driver,
  meta,
  recentOrders,
  restaurantPins = [],
  variant = "sidebar",
  onClose,
}: {
  driver: DriverLiveLocation | null;
  meta?: LiveDriverMeta;
  recentOrders: LiveRecentDelivery[];
  restaurantPins?: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    map_link: string | null;
  }>;
  variant?: "sidebar" | "stacked";
  onClose?: () => void;
}) {
  const t = useTranslations("pages.liveTracking");

  if (!driver) {
    if (variant === "stacked") return null;
    return (
      <TrackingGlassCard className="flex min-h-[280px] flex-col items-center justify-center p-6 text-center">
        <div className="mb-3 rounded-full border border-slate-200 bg-slate-100 p-2.5 dark:border-slate-700 dark:bg-slate-800">
          <Package className="h-7 w-7 text-slate-400 dark:text-slate-300" />
        </div>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {t("selectDriverTitle")}
        </p>
        <p className="mt-1 max-w-[240px] text-xs text-slate-500 dark:text-slate-300">
          {t("selectDriverHint")}
        </p>
      </TrackingGlassCard>
    );
  }

  const gpsQuality = gpsQualityFromAccuracy(driver.accuracyMeters);
  const signalBars =
    gpsQuality === "excellent" ? 4 : gpsQuality === "good" ? 3 : gpsQuality === "weak" ? 2 : 1;
  const latestOrder = recentOrders[0] ?? null;

  const gpsLive = isGpsLive(driver.lastSeenAt);
  const dutyLabel = !gpsLive ? t("gpsLost") : driver.isOnDuty ? t("onDuty") : t("offDuty");
  const dutyTone = !gpsLive ? "neutral" : driver.isOnDuty ? "success" : "neutral";

  if (variant === "stacked") {
    return (
      <TrackingGlassCard className="relative w-full overflow-hidden">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="absolute end-1.5 top-1.5 z-10 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Close driver details"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}

        <div className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-700/80">
          <div className="flex items-center gap-2 pe-6">
            <Avatar className="h-9 w-9 shrink-0 rounded-lg">
              {meta?.avatarUrl ? <AvatarImage src={meta.avatarUrl} alt="" /> : null}
              <AvatarFallback
                className={cn("rounded-lg text-xs font-semibold", avatarTintFromName(driver.driverName))}
              >
                {driverInitials(driver.driverName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {driver.driverName}
                </p>
                <Pill tone={dutyTone} variant="solid" className="text-[9px]">
                  {dutyLabel}
                </Pill>
              </div>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-300">
                {driver.driverCode} · {meta?.zoneName ?? "—"}
              </p>
            </div>
            {meta?.phone ? (
              <a href={`tel:${meta.phone}`} className="shrink-0">
                <IconButton icon={Phone} compact />
              </a>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5 px-3 py-2">
          <CompactStat label={t("currentSpeed")} value={formatSpeedKmh(driver.speedMps)} />
          <CompactStat label={t("colBattery")} value={formatBatteryLevel(driver.batteryPct)} />
          <CompactStat label={t("colAccuracy")} value={formatAccuracyMeters(driver.accuracyMeters)} />
          <CompactStat label={t("lastGpsUpdate")} value={formatDurationSince(driver.updatedAt)} />
        </div>

        <div className="border-t border-slate-200 px-3 py-2 dark:border-slate-700/80">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h4 className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">
              {t("recentOrders")}
            </h4>
            <SignalBars value={signalBars} />
          </div>
          {latestOrder ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                  #{latestOrder.shortId}
                </p>
                <Pill tone={deliveryStatusTone(latestOrder.status)} className="text-[9px]">
                  {deliveryStatusLabel(latestOrder.status)}
                </Pill>
              </div>
              <p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-300">
                {latestOrder.partnerName}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-slate-300">
                {formatDurationSince(latestOrder.deliveredAt)}
              </p>
            </div>
          ) : (
            <p className="text-[10px] text-slate-500 dark:text-slate-300">{t("noHistory")}</p>
          )}
        </div>

        {restaurantPins.length > 0 ? (
          <div className="border-t border-slate-200 px-3 py-2 dark:border-slate-700/80">
            <h4 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-900 dark:text-slate-100">
              <MapPin className="h-3 w-3" />
              {t("assignedRestaurants")}
            </h4>
            <ul className="space-y-1">
              {restaurantPins.map((pin) => (
                <li key={pin.id}>
                  <Link
                    href={`/restaurants/${pin.id}`}
                    className="block truncate text-[10px] text-primary hover:underline"
                  >
                    {pin.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </TrackingGlassCard>
    );
  }

  return (
    <TrackingGlassCard className="relative flex min-h-0 flex-col overflow-hidden">
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="absolute end-2 top-2 z-10 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          aria-label="Close driver details"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <div className="relative border-b border-slate-200 px-4 py-3 dark:border-slate-700/80">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/60">
          <div className="flex items-start gap-3">
            <Avatar className="h-12 w-12 shrink-0 rounded-lg">
              {meta?.avatarUrl ? <AvatarImage src={meta.avatarUrl} alt="" /> : null}
              <AvatarFallback
                className={cn("rounded-lg text-base font-semibold", avatarTintFromName(driver.driverName))}
              >
                {driverInitials(driver.driverName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {driver.driverName}
                </p>
                <Pill tone={dutyTone} variant="solid">
                  {dutyLabel}
                </Pill>
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-300">
                {driver.driverCode}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-300">{meta?.zoneName ?? "—"}</p>
              <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                <Bike className="h-3 w-3" />
                {t("filterVehicleType")} : Bike
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {meta?.phone ? (
                <a href={`tel:${meta.phone}`}>
                  <IconButton icon={Phone} />
                </a>
              ) : (
                <IconButton icon={Phone} />
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-300">{t("lastGpsUpdate")}</p>
              <p className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                {formatDurationSince(driver.updatedAt)}
              </p>
            </div>
            <div className="text-end">
              <p className="text-[11px] text-slate-500 dark:text-slate-300">{t("gpsQuality")}</p>
              <p className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                {t(`gpsQualityLevel.${gpsQuality}`)}
              </p>
              <SignalBars value={signalBars} className="ms-auto mt-1" />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3 overflow-y-auto p-4">
        <section>
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label={t("currentSpeed")} value={formatSpeedKmh(driver.speedMps)} />
            <MiniMetric
              label={t("metricDistanceToday")}
              value={formatDistanceMeters(driver.distanceTodayMeters)}
            />
            <MiniMetric label={t("colBattery")} value={formatBatteryLevel(driver.batteryPct)} />
            <MiniMetric label={t("gpsQuality")} value={t(`gpsQualityLevel.${gpsQuality}`)} />
            <MiniMetric label={t("colAccuracy")} value={formatAccuracyMeters(driver.accuracyMeters)} />
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-300">
            <StatusDot
              tone={
                driver.pinStatus === "alert"
                  ? "danger"
                  : driver.pinStatus === "active"
                    ? "success"
                    : "warning"
              }
            />
            <span>{t("liveMetrics")}</span>
            <SignalBars value={signalBars} />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {t("recentOrders")}
          </h4>
          {recentOrders.length === 0 ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">{t("noHistory")}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {recentOrders.map((order) => (
                <li
                  key={order.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      #{order.shortId}
                    </p>
                    <Pill tone={deliveryStatusTone(order.status)}>{deliveryStatusLabel(order.status)}</Pill>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-300">
                    {order.partnerName}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-300">
                    {formatDurationSince(order.deliveredAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {restaurantPins.length > 0 ? (
          <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <MapPin className="h-3.5 w-3.5" />
              {t("assignedRestaurants")}
            </h4>
            <ul className="mt-2 space-y-1">
              {restaurantPins.map((pin) => (
                <li key={pin.id}>
                  <Link
                    href={`/restaurants/${pin.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    {pin.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t("activityTimeline")}
            </h4>
            <Badge variant="secondary" className="text-[10px]">
              {t("comingSoon")}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
            {t("comingSoon")}
          </p>
        </section>
      </div>
    </TrackingGlassCard>
  );
}

function IconButton({ icon: Icon, compact }: { icon: typeof Phone; compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
        compact ? "h-7 w-7" : "h-7 w-7",
      )}
    >
      <Icon className={compact ? "h-3.5 w-3.5" : "h-3.5 w-3.5"} />
    </span>
  );
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-1 dark:border-slate-700 dark:bg-slate-800/60">
      <p className="truncate text-[9px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="truncate text-[11px] font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {value}
      </p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800/60">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">
        {value}
      </p>
    </div>
  );
}

function deliveryStatusLabel(status: LiveRecentDelivery["status"]): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "pending":
      return "Pending";
    case "rejected":
      return "Rejected";
    case "in_transit":
      return "In transit";
    case "cancelled":
      return "Cancelled";
    default:
      return "Under review";
  }
}

function deliveryStatusTone(status: LiveRecentDelivery["status"]): Tone {
  switch (status) {
    case "verified":
      return "success";
    case "pending":
      return "warning";
    case "rejected":
    case "cancelled":
      return "danger";
    case "in_transit":
      return "primary";
    default:
      return "primary";
  }
}
