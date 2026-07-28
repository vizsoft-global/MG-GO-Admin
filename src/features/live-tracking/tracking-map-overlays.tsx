"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Expand,
  X,
  LocateFixed,
  Mail,
  MapPin,
  Minus,
  Navigation,
  Phone,
  Plus,
} from "lucide-react";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Pill, SignalBars, StatusDot, type Tone } from "@/components/ui/metric-tile";
import { cn } from "@/lib/utils";
import type { DriverLiveLocation } from "@/features/locations/types";
import {
  formatBatteryLevel,
  formatDurationSince,
  formatSpeedKmh,
  gpsQualityFromAccuracy,
  driverInitials,
} from "./tracking-metrics";
import {
  fleetStatusFromLocation,
  LEGEND_FILTERABLE_STATUSES,
  LEGEND_STATUSES,
  type FleetStatusKey,
} from "./tracking-status";
import { TrackingGlassCard } from "./tracking-shell";
import type { LiveDriverMeta } from "./live-tracking-types";
import type { TrackingMapLayerPrefs } from "./tracking-map-layer-prefs";
import { TrackingMapLayersPopover } from "./tracking-map-layers-popover";

export type MapLayerToggle = "live" | "traffic" | "heatmap";

export function TrackingMapToolbar({
  activeLayer,
  onLayerChange,
  geofencesEnabled,
  onToggleGeofences,
  onRecenter,
  onMapFullscreen,
  onZoomIn,
  onZoomOut,
  prefs,
  onPrefsChange,
  onToggleTraffic,
}: {
  activeLayer: MapLayerToggle;
  onLayerChange: (layer: MapLayerToggle) => void;
  geofencesEnabled: boolean;
  onToggleGeofences: () => void;
  onRecenter: () => void;
  onMapFullscreen: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  prefs: TrackingMapLayerPrefs;
  onPrefsChange: (next: TrackingMapLayerPrefs) => void;
  onToggleTraffic: (enabled: boolean) => void;
}) {
  const t = useTranslations("pages.liveTracking");

  const mapPills: Array<{ id: "live" | "traffic" | "heatmap"; label: string }> = [
    { id: "live", label: t("mapLayerLive") },
    { id: "traffic", label: t("mapLayerTraffic") },
    { id: "heatmap", label: t("mapLayerHeatmap") },
  ];

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-between p-3">
        <div className="pointer-events-auto inline-flex items-center gap-1 rounded-xl border border-border bg-card/95 p-1 shadow-sm">
          {mapPills.map((pill) => {
            const isActive = activeLayer === pill.id;
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => onLayerChange(pill.id)}
                className={cn(
                  "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {pill.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onToggleGeofences}
          className={cn(
            "pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium shadow-sm transition-colors",
            geofencesEnabled
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-card/95 text-foreground hover:bg-accent",
          )}
        >
          <MapPin className="h-3.5 w-3.5" />
          {t("mapLayerGeofences")}
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-col gap-2">
        <button
          type="button"
          onClick={onRecenter}
          className="pointer-events-auto inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-card/95 text-foreground shadow-sm transition-colors hover:bg-accent"
          title={t("recenter")}
        >
          <LocateFixed className="h-4 w-4" />
        </button>
      </div>

      <div className="pointer-events-none absolute right-3 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2">
        <button
          type="button"
          onClick={onZoomIn}
          className="pointer-events-auto inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-card/95 text-foreground shadow-sm transition-colors hover:bg-accent"
          title={t("zoomIn")}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onZoomOut}
          className="pointer-events-auto inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-card/95 text-foreground shadow-sm transition-colors hover:bg-accent"
          title={t("zoomOut")}
        >
          <Minus className="h-4 w-4" />
        </button>
        <TrackingMapLayersPopover
          className="pointer-events-auto"
          prefs={prefs}
          onChange={onPrefsChange}
          trafficEnabled={activeLayer === "traffic"}
          onToggleTraffic={onToggleTraffic}
        />
        <button
          type="button"
          onClick={onMapFullscreen}
          className="pointer-events-auto inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-card/95 text-foreground shadow-sm transition-colors hover:bg-accent"
          title={t("fullscreen")}
        >
          <Expand className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}

export function TrackingMapLegend({
  activeStatuses,
  onToggleStatus,
  clusterCount,
}: {
  activeStatuses: FleetStatusKey[];
  onToggleStatus: (status: FleetStatusKey) => void;
  clusterCount: number;
}) {
  const t = useTranslations("pages.liveTracking");

  const toneByStatus: Record<FleetStatusKey, Tone> = {
    available: "success",
    delivering: "primary",
    idle: "warning",
    break: "primary",
    offline: "neutral",
    alert: "danger",
    cluster: "primary",
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
      <TrackingGlassCard className="pointer-events-auto w-full max-w-3xl rounded-xl border-slate-200 bg-white/95 px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/95">
        <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {LEGEND_STATUSES.map((status) => {
            const isInteractive = LEGEND_FILTERABLE_STATUSES.includes(status);
            const active = activeStatuses.includes(status);
            return (
              <li key={status}>
                <ToggleChip
                  selected={active}
                  disabled={!isInteractive}
                  onClick={() => (isInteractive ? onToggleStatus(status) : undefined)}
                  className={cn(
                    "h-6 rounded-full px-2 text-[11px] font-medium shadow-none transition-opacity",
                    isInteractive && !active && "opacity-45",
                  )}
                >
                  <StatusDot tone={toneByStatus[status]} />
                  <span>{t(`fleetStatus.${status}`)}</span>
                </ToggleChip>
              </li>
            );
          })}
          <li className="inline-flex items-center gap-1.5 text-[11px] text-slate-700 dark:text-slate-200">
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {clusterCount}
            </span>
            <span>{t("fleetStatus.cluster")}</span>
          </li>
        </ul>
      </TrackingGlassCard>
    </div>
  );
}

export function TrackingSelectedDriverPopup({
  driver,
  meta,
  onViewDetails,
  onClose,
}: {
  driver: DriverLiveLocation;
  meta?: LiveDriverMeta;
  onViewDetails?: () => void;
  onClose?: () => void;
}) {
  const t = useTranslations("pages.liveTracking");
  const fleetStatus = fleetStatusFromLocation({
    pinStatus: driver.pinStatus,
    trackingStatus: driver.trackingStatus,
    isOnDuty: driver.isOnDuty,
  });
  const speed = formatSpeedKmh(driver.speedMps);
  const gpsQuality = gpsQualityFromAccuracy(driver.accuracyMeters);

  const toneByStatus: Record<FleetStatusKey, Tone> = {
    available: "success",
    delivering: "primary",
    idle: "warning",
    break: "primary",
    offline: "neutral",
    alert: "danger",
    cluster: "primary",
  };

  return (
    <TrackingGlassCard className="pointer-events-auto absolute left-1/2 top-1/2 z-20 w-[360px] max-w-[calc(100%-24px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border-slate-200 bg-white/98 p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900/96">
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="absolute end-2 top-2 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          aria-label="Close selected driver"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <div className="flex items-start gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sm font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-200">
          {driverInitials(driver.driverName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {driver.driverName}
            </p>
            <Pill tone={driver.isOnDuty ? "success" : "neutral"} variant="solid">
              {driver.isOnDuty ? t("onDuty") : t("offDuty")}
            </Pill>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-300">
            {driver.driverCode} <span className="mx-1">·</span> {speed}
          </p>
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/80 p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800/60">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-500 dark:text-slate-300">{t("colBattery")}</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {formatBatteryLevel(driver.batteryPct)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-500 dark:text-slate-300">{t("colLastSeen")}</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {formatDurationSince(driver.lastSeenAt)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-slate-500 dark:text-slate-300">{t("gpsQuality")}</dt>
          <dd className="font-semibold text-slate-900 dark:text-slate-100">
            {t(`gpsQualityLevel.${gpsQuality}`)}
          </dd>
        </div>
      </dl>

      <p className="mt-2 truncate text-[11px] text-slate-500 dark:text-slate-300">
        {meta?.zoneName ?? "—"}
      </p>

      <div className="mt-3 grid grid-cols-4 divide-x divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
        <OverlayAction
          label={t("viewDetails")}
          icon={Navigation}
          href={meta?.detailHref ?? undefined}
          onClick={onViewDetails}
        />
        <OverlayAction
          label={t("call")}
          icon={Phone}
          href={meta?.phone ? `tel:${meta.phone}` : undefined}
        />
        <OverlayAction label={t("message")} icon={Mail} />
        <OverlayAction label={t("assignOrder")} icon={MapPin} />
      </div>

      <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-300">
        <Pill tone={toneByStatus[fleetStatus]}>{t(`fleetStatus.${fleetStatus}`)}</Pill>
        <StatusDot tone={toneByStatus[fleetStatus]} />
        <span className="mx-1">•</span>
        <span>{t(`gpsQualityLevel.${gpsQuality}`)}</span>
        <SignalBars
          value={
            gpsQuality === "excellent"
              ? 4
              : gpsQuality === "good"
                ? 3
                : gpsQuality === "weak"
                  ? 2
                  : 1
          }
        />
      </div>
    </TrackingGlassCard>
  );
}

function OverlayAction({
  label,
  icon: Icon,
  href,
  onClick,
}: {
  label: string;
  icon: typeof MapPin;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <span className="inline-flex w-full flex-col items-center gap-1 px-1 py-2 text-[10px] text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100">
      <Icon className="h-3.5 w-3.5" />
      <span className="text-center leading-tight">{label}</span>
    </span>
  );

  if (href) {
    if (href.startsWith("tel:")) {
      return (
        <a href={href} className="cursor-pointer">
          {content}
        </a>
      );
    }
    return (
      <Link href={href} className="cursor-pointer">
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className="cursor-pointer">
      {content}
    </button>
  );
}

export function legendStatusLabel(
  t: ReturnType<typeof useTranslations<"pages.liveTracking">>,
  status: FleetStatusKey,
): string {
  return t(`fleetStatus.${status}`);
}
