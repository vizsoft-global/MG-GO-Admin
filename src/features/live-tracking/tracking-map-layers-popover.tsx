"use client";

import { Check, Layers2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  styleAllowsHideLabels,
  type TrackingMapLayerPrefs,
  type TrackingMapStyleId,
} from "./tracking-map-layer-prefs";

type StyleOption = {
  id: TrackingMapStyleId;
  label: string;
  /** Tailwind background classes used for the small swatch in the picker. */
  swatch: string;
};

export function TrackingMapLayersPopover({
  prefs,
  onChange,
  trafficEnabled,
  onToggleTraffic,
  className,
}: {
  prefs: TrackingMapLayerPrefs;
  onChange: (next: TrackingMapLayerPrefs) => void;
  trafficEnabled: boolean;
  onToggleTraffic: (enabled: boolean) => void;
  className?: string;
}) {
  const t = useTranslations("pages.liveTracking");

  const mapTypes: StyleOption[] = [
    {
      id: "roadmap",
      label: t("mapTypeRoadmap"),
      swatch: "bg-[linear-gradient(135deg,#f8fafc_0%,#e5e7eb_100%)]",
    },
    {
      id: "satellite",
      label: t("mapTypeSatellite"),
      swatch: "bg-[linear-gradient(135deg,#1e3a2f_0%,#3f6f4d_60%,#7ea98c_100%)]",
    },
    {
      id: "hybrid",
      label: t("mapTypeHybrid"),
      swatch: "bg-[linear-gradient(135deg,#1e3a2f_0%,#475569_50%,#cbd5e1_100%)]",
    },
    {
      id: "google",
      label: t("mapTypeGoogle"),
      swatch: "bg-[linear-gradient(135deg,#fef3c7_0%,#f5f5dc_60%,#e7eaf0_100%)]",
    },
    {
      id: "dark",
      label: t("mapTypeDark"),
      swatch: "bg-[linear-gradient(135deg,#0f172a_0%,#334155_70%,#475569_100%)]",
    },
    {
      id: "retro",
      label: t("mapTypeRetro"),
      swatch: "bg-[linear-gradient(135deg,#ebe3cd_0%,#dfd2ae_55%,#f8c967_100%)]",
    },
  ];

  const labelsToggleEnabled = styleAllowsHideLabels(prefs.mapTypeId);

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className={cn(
          "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-border bg-card/95 text-foreground shadow-sm transition-colors hover:bg-accent",
          className,
        )}
        title={t("layers")}
      >
        <Layers2 className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4 p-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("mapType")}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {mapTypes.map((item) => {
              const active = prefs.mapTypeId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  className={cn(
                    "group relative flex cursor-pointer flex-col items-stretch gap-1 rounded-md border p-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted/30 text-foreground hover:bg-muted",
                  )}
                  onClick={() => onChange({ ...prefs, mapTypeId: item.id })}
                >
                  <span
                    className={cn(
                      "h-9 w-full rounded-sm border border-border/40 shadow-inner",
                      item.swatch,
                    )}
                    aria-hidden
                  />
                  <span className="truncate text-center text-[11px] leading-tight">
                    {item.label}
                  </span>
                  {active ? (
                    <span className="absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                      <Check className="h-3 w-3" aria-hidden />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-foreground">{t("mapLayerTraffic")}</p>
            <Switch
              checked={trafficEnabled}
              onCheckedChange={onToggleTraffic}
              aria-label={t("mapLayerTraffic")}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p
              className={cn(
                "text-sm",
                labelsToggleEnabled ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {t("hideMapLabels")}
            </p>
            <Switch
              checked={labelsToggleEnabled ? prefs.hideLabels : false}
              onCheckedChange={(checked) =>
                onChange({ ...prefs, hideLabels: checked })
              }
              disabled={!labelsToggleEnabled}
              aria-label={t("hideMapLabels")}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
