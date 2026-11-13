"use client";

import type { LucideIcon } from "lucide-react";
import { BatteryCharging, Check, CreditCard, HardHat, Shirt, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { INTERACTIVE_TILE, NEUTRAL_TILE, SELECTED_TILE } from "@/lib/ui/tone-styles";
import type { FleetAssetKpi, FleetAssetKpiCode } from "./types";

const ICONS: Record<FleetAssetKpiCode, LucideIcon> = {
  helmet: HardHat,
  vest: Shirt,
  fuel_chip: CreditCard,
  phone_holder: Smartphone,
  charger: BatteryCharging,
};

export function AssetsFleetKpiStrip({
  items,
  usedLabel,
  remainingLabel,
  activeCode,
  onSelectCode,
}: {
  items: FleetAssetKpi[];
  usedLabel: string;
  remainingLabel: string;
  activeCode?: FleetAssetKpiCode | null;
  onSelectCode?: (code: FleetAssetKpiCode) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {items.map((item) => {
        const Icon = ICONS[item.code];
        const selected = activeCode === item.code;
        return (
          <button
            key={item.code}
            type="button"
            onClick={onSelectCode ? () => onSelectCode(item.code) : undefined}
            aria-pressed={onSelectCode ? selected : undefined}
            disabled={!onSelectCode}
            className={cn(
              "rounded-xl p-3 text-start",
              NEUTRAL_TILE,
              onSelectCode && INTERACTIVE_TILE,
              selected && SELECTED_TILE,
            )}
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {item.name}
              </p>
              {selected ? (
                <span className="ms-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-white">
                  <Check className="h-3 w-3" />
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xl font-semibold tabular-nums">{item.total}</p>
            <p className="text-xs text-muted-foreground">
              {usedLabel} {item.used} · {remainingLabel} {item.remaining}
            </p>
          </button>
        );
      })}
    </div>
  );
}
