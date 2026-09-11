"use client";

import type { LucideIcon } from "lucide-react";
import { BatteryCharging, CreditCard, HardHat, Shirt, Smartphone } from "lucide-react";
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
}: {
  items: FleetAssetKpi[];
  usedLabel: string;
  remainingLabel: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {items.map((item) => {
        const Icon = ICONS[item.code];
        return (
          <div key={item.code} className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {item.name}
              </p>
            </div>
            <p className="mt-1 text-xl font-semibold tabular-nums">{item.total}</p>
            <p className="text-[10px] text-muted-foreground">
              {usedLabel} {item.used} · {remainingLabel} {item.remaining}
            </p>
          </div>
        );
      })}
    </div>
  );
}
