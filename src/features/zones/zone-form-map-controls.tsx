"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Locate, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ZONE_MAP_PREFS,
  loadZoneMapPrefs,
  saveZoneMapPrefs,
  subscribeZoneMapPrefs,
  type ZoneMapLayerPrefs,
} from "./zone-map-layer-prefs";
import type { ZoneMapAdapter, ZoneMapType } from "./zone-map-adapter";

const FORM_MAP_TYPES: Array<{ id: ZoneMapType; labelKey: "roadmap" | "satellite" | "hybrid" }> = [
  { id: "roadmap", labelKey: "roadmap" },
  { id: "satellite", labelKey: "satellite" },
  { id: "hybrid", labelKey: "hybrid" },
];

export function ZoneFormMapTypeToggle({
  adapter,
  className,
}: {
  adapter: ZoneMapAdapter | null;
  className?: string;
}) {
  const t = useTranslations("pages.zones.layers");
  const [prefs, setPrefs] = useState<ZoneMapLayerPrefs>(DEFAULT_ZONE_MAP_PREFS);

  useEffect(() => {
    setPrefs(loadZoneMapPrefs());
    const unsub = subscribeZoneMapPrefs(setPrefs);
    return unsub;
  }, []);

  const setMapType = (next: ZoneMapType) => {
    const updated = { ...prefs, mapType: next };
    setPrefs(updated);
    saveZoneMapPrefs(updated);
    adapter?.setMapType?.(next);
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-md dark:border-slate-700 dark:bg-slate-900",
        className,
      )}
      role="radiogroup"
      aria-label="Map type"
    >
      {FORM_MAP_TYPES.map(({ id, labelKey }) => {
        const active = prefs.mapType === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setMapType(id)}
            role="radio"
            aria-checked={active}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "text-primary"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white",
            )}
          >
            <span
              className={cn(
                "flex h-3.5 w-3.5 items-center justify-center rounded-full border",
                active ? "border-primary" : "border-slate-300 dark:border-slate-600",
              )}
              aria-hidden
            >
              {active ? (
                <span className="h-2 w-2 rounded-full bg-primary" />
              ) : null}
            </span>
            <span>{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ZoneFormZoomControls({
  adapter,
  className,
}: {
  adapter: ZoneMapAdapter | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-px rounded-xl border border-slate-200 bg-white p-1 shadow-md dark:border-slate-700 dark:bg-slate-900",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => adapter?.zoomIn?.()}
        className="cursor-pointer rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        aria-label="Zoom in"
      >
        <Plus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => adapter?.zoomOut?.()}
        className="cursor-pointer rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        aria-label="Zoom out"
      >
        <Minus className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ZoneFormFindMyLocation({
  adapter,
  className,
}: {
  adapter: ZoneMapAdapter | null;
  className?: string;
}) {
  const t = useTranslations("pages.zones.geofence");
  const [pending, setPending] = useState(false);

  const handleClick = () => {
    if (!adapter) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error(t("locationUnavailable"));
      return;
    }
    setPending(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        adapter.panTo(position.coords.latitude, position.coords.longitude, 15);
        setPending(false);
      },
      (error) => {
        setPending(false);
        if (error.code === error.PERMISSION_DENIED) {
          toast.error(t("locationDenied"));
        } else {
          toast.error(t("locationUnavailable"));
        }
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={t("findMyLocation")}
      title={t("findMyLocation")}
      className={cn(
        "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-md transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
        className,
      )}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Locate className="h-4 w-4" />
      )}
    </button>
  );
}
