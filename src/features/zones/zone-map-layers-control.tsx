"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Layers } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  GoogleMapInstance,
  GoogleMapsApi,
  GoogleOverlayLayer,
} from "@/lib/google-maps/load";
import {
  DEFAULT_ZONE_MAP_PREFS,
  loadZoneMapPrefs,
  saveZoneMapPrefs,
  type ZoneMapLayerPrefs,
} from "./zone-map-layer-prefs";
import { buildZoneMapStyles } from "./zone-map-google-styles";

const MAP_TYPES = [
  { id: "roadmap", labelKey: "roadmap" as const },
  { id: "satellite", labelKey: "satellite" as const },
  { id: "hybrid", labelKey: "hybrid" as const },
  { id: "terrain", labelKey: "terrain" as const },
];

export function ZoneMapLayersControl({
  map,
  google,
  className,
}: {
  map: GoogleMapInstance | null;
  google: GoogleMapsApi | null;
  className?: string;
}) {
  const t = useTranslations("pages.zones.layers");
  const [prefs, setPrefs] = useState<ZoneMapLayerPrefs>(DEFAULT_ZONE_MAP_PREFS);
  const trafficRef = useRef<GoogleOverlayLayer | null>(null);
  const transitRef = useRef<GoogleOverlayLayer | null>(null);
  const bicyclingRef = useRef<GoogleOverlayLayer | null>(null);

  useEffect(() => {
    setPrefs(loadZoneMapPrefs());
  }, []);

  const applyPrefs = (next: ZoneMapLayerPrefs) => {
    if (!map || !google) return;
    map.setMapTypeId(next.mapType);
    map.setOptions({ styles: buildZoneMapStyles(next.hideLabels) });
    if (!trafficRef.current) trafficRef.current = new google.maps.TrafficLayer();
    if (!transitRef.current) transitRef.current = new google.maps.TransitLayer();
    if (!bicyclingRef.current) bicyclingRef.current = new google.maps.BicyclingLayer();
    trafficRef.current.setMap(next.traffic ? map : null);
    transitRef.current.setMap(next.transit ? map : null);
    bicyclingRef.current.setMap(next.bicycling ? map : null);
  };

  useEffect(() => {
    if (!map || !google) return;
    applyPrefs(prefs);
  }, [map, google, prefs]);

  const update = (patch: Partial<ZoneMapLayerPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveZoneMapPrefs(next);
      return next;
    });
  };

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className={cn(
          "border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex h-9 cursor-pointer items-center rounded-full border px-3 text-sm font-medium shadow-sm backdrop-blur-sm",
          className,
        )}
      >
        <Layers className="me-1.5 h-3.5 w-3.5" />
        {t("title")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-4 p-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("mapType")}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {MAP_TYPES.map(({ id, labelKey }) => (
              <button
                key={id}
                type="button"
                onClick={() => update({ mapType: id })}
                className={cn(
                  "cursor-pointer rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                  prefs.mapType === id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted/30 text-foreground hover:bg-muted",
                )}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("overlays")}
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="layer-live-drivers" className="text-sm font-normal">
                {t("liveDrivers")}
              </Label>
              <Switch
                id="layer-live-drivers"
                checked={prefs.showLiveDrivers}
                onCheckedChange={(checked) => update({ showLiveDrivers: checked })}
              />
            </div>
            {(
              [
                { key: "traffic" as const, label: t("traffic") },
                { key: "transit" as const, label: t("transit") },
                { key: "bicycling" as const, label: t("bicycling") },
              ] as const
            ).map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <Label htmlFor={`layer-${key}`} className="text-sm font-normal">
                  {label}
                </Label>
                <Switch
                  id={`layer-${key}`}
                  checked={prefs[key]}
                  onCheckedChange={(checked) => update({ [key]: checked })}
                />
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("display")}
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="layer-show-zone-labels" className="text-sm font-normal">
                {t("showLabels")}
              </Label>
              <Switch
                id="layer-show-zone-labels"
                checked={prefs.showLabels}
                onCheckedChange={(checked) => update({ showLabels: checked })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="layer-hide-labels" className="text-sm font-normal">
                {t("hideLabels")}
              </Label>
              <Switch
                id="layer-hide-labels"
                checked={prefs.hideLabels}
                onCheckedChange={(checked) => update({ hideLabels: checked })}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("hideLabelsHint")}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
