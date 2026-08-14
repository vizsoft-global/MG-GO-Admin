"use client";

/**
 * One driver row in the floating rail.
 *
 * The card subscribes to *its own driver only* (`useFleetDriver`), so a driver moving
 * re-renders one card rather than the list. That is the single biggest departure from
 * the v1 page, where every GPS frame re-rendered the whole sidebar.
 */

import { memo } from "react";
import { useTranslations } from "next-intl";
import { Battery, BatteryLow, Clock, Map as MapIcon, Navigation, Package } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { avatarTintFromName } from "@/features/drivers/form/driver-form-primitives";

import { activeFleetFlags, fleetFlagTone, fleetStatusTone } from "./fleet-status";
import { FLEET_TONE_BADGE, FLEET_TONE_DOT } from "./fleet-tone";
import { useFleetDriver } from "./use-fleet";

const MS_PER_MINUTE = 60_000;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

function formatDuration(sinceIso: string | null): string | null {
  if (!sinceIso) return null;
  const started = Date.parse(sinceIso);
  if (Number.isNaN(started)) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - started) / MS_PER_MINUTE));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export const FleetDriverCard = memo(function FleetDriverCard({
  driverId,
  selected,
  onSelect,
  onFocus,
}: {
  driverId: string;
  selected: boolean;
  onSelect: (driverId: string) => void;
  onFocus: (driverId: string) => void;
}) {
  const t = useTranslations("pages.liveTrackingV2");
  const driver = useFleetDriver(driverId);

  if (!driver) return null;

  const { meta } = driver;
  const name = meta.driverName || meta.driverCode || driverId;
  const statusTone = fleetStatusTone(driver.status);
  const flags = activeFleetFlags(driver.flags);
  // `on_duty` and `online` are conditions, not exceptions — showing them as badges on
  // every on-duty card would bury the two or three that actually need attention.
  const badgeFlags = flags.filter((flag) => flag !== "on_duty" && flag !== "online");

  const speedKmh = Math.round(driver.speedMps * 3.6);
  const distanceKm = meta.distanceTodayMeters / 1000;
  const onDutyFor = formatDuration(meta.onDutySince);
  const deliveryProgress =
    meta.deliveriesToday > 0
      ? Math.min(100, Math.round((meta.deliveriesCompletedToday / meta.deliveriesToday) * 100))
      : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(driverId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(driverId);
        }
      }}
      className={cn(
        "group w-full cursor-pointer rounded-lg border bg-card/95 p-2 text-start transition-[border-color,box-shadow] duration-150 ease-out",
        selected
          ? "border-foreground/70 shadow-md"
          : "border-border hover:border-muted-foreground/40",
      )}
    >
      <div className="flex items-start gap-2">
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

          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="rounded border border-primary/20 bg-primary/10 px-1 font-mono tabular-nums text-primary">
              {meta.driverCode}
            </span>
            <span className="truncate">{meta.currentZoneName ?? meta.zoneName ?? t("rail.noZone")}</span>
          </div>
        </div>
      </div>

      {badgeFlags.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {badgeFlags.map((flag) => (
            <span
              key={flag}
              className={cn(
                "inline-flex items-center rounded border px-1 py-px text-[9px] font-semibold",
                FLEET_TONE_BADGE[fleetFlagTone(flag)],
              )}
            >
              {t(`flags.${flag}`)}
            </span>
          ))}
        </div>
      ) : null}

      {meta.deliveriesToday > 0 ? (
        <div className="mt-1.5">
          <div className="fleet-progress-track h-1 w-full overflow-hidden rounded-full">
            <div
              className="fleet-progress-fill h-full rounded-full transition-[width] duration-200 ease-out"
              style={{ width: `${deliveryProgress}%` }}
            />
          </div>
          <p className="mt-0.5 text-[9px] text-muted-foreground">
            {t("rail.progress")} · {meta.deliveriesCompletedToday}/{meta.deliveriesToday}
          </p>
        </div>
      ) : null}

      <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px]">
        <Stat
          icon={<Navigation className="size-3" aria-hidden />}
          label={t("rail.speed")}
          value={`${speedKmh} km/h`}
        />
        <Stat
          icon={<MapIcon className="size-3" aria-hidden />}
          label={t("rail.distanceToday")}
          value={`${distanceKm.toFixed(1)} km`}
        />
        <Stat
          icon={<Package className="size-3" aria-hidden />}
          label={t("rail.deliveries")}
          value={`${meta.deliveriesCompletedToday}`}
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
          {onDutyFor ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden />
              {onDutyFor}
            </span>
          ) : null}
          {meta.batteryPct != null ? (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                driver.flags.low_battery && "text-amber-700",
              )}
            >
              {driver.flags.low_battery ? (
                <BatteryLow className="size-3" aria-hidden />
              ) : (
                <Battery className="size-3" aria-hidden />
              )}
              {meta.batteryPct}%
            </span>
          ) : null}
        </div>

        {/* View and focus must not look alike (§8): focus is the map glyph, view is a
            text link to the driver's detail page. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={t("rail.focus")}
            title={t("rail.focus")}
            onClick={(event) => {
              event.stopPropagation();
              onFocus(driverId);
            }}
            className="grid size-6 cursor-pointer place-items-center rounded text-primary transition-colors duration-150 hover:bg-primary/10"
          >
            <MapIcon className="size-3.5" aria-hidden />
          </button>
          <Link
            href={`/drivers/${driverId}`}
            onClick={(event) => event.stopPropagation()}
            className="rounded px-1 text-[10px] font-medium text-primary transition-colors duration-150 hover:bg-primary/10"
          >
            {t("rail.viewDetails")}
          </Link>
        </div>
      </div>
    </div>
  );
});

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded border border-border/60 bg-muted/30 px-1 py-0.5">
      <p className="flex items-center gap-0.5 text-[9px] leading-tight text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </p>
      <p className="truncate text-[10px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}
