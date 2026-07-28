"use client";

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Boxes, PackageCheck, PackageMinus, Tags } from "lucide-react";
import { MetricTile, type Tone } from "@/components/ui/metric-tile";
import type { AssetCatalogKpis } from "./types";

type KpiItem = {
  id: string;
  label: string;
  value: number;
  icon: LucideIcon;
  tone: Tone;
};

export function AssetsKpiStrip({
  kpis,
  labels,
}: {
  kpis: AssetCatalogKpis;
  labels: {
    skus: string;
    units: string;
    assigned: string;
    available: string;
    lowStock: string;
  };
}) {
  const items: KpiItem[] = [
    { id: "skus", label: labels.skus, value: kpis.total_skus, icon: Tags, tone: "primary" },
    { id: "units", label: labels.units, value: kpis.total_units, icon: Boxes, tone: "neutral" },
    {
      id: "assigned",
      label: labels.assigned,
      value: kpis.assigned_units,
      icon: PackageMinus,
      tone: "warning",
    },
    {
      id: "available",
      label: labels.available,
      value: kpis.available_units,
      icon: PackageCheck,
      tone: "success",
    },
    {
      id: "lowStock",
      label: labels.lowStock,
      value: kpis.low_stock_count,
      icon: AlertTriangle,
      tone: "danger",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      {items.map((item) => (
        <MetricTile
          key={item.id}
          label={item.label}
          value={item.value.toLocaleString()}
          icon={item.icon}
          tone={item.tone}
          className="p-2.5"
        />
      ))}
    </div>
  );
}
