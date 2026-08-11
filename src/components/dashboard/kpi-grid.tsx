import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { KpiCard, type KpiAccent } from "@/components/dashboard/kpi-card";

export type KpiGridItem = {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: KpiAccent;
  caption?: ReactNode;
};

export function KpiGrid({
  items,
  compact = false,
}: {
  items: KpiGridItem[];
  /** Pass on pages where the KPI strip shares the viewport with a table or charts. */
  compact?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {items.map((kpi) => (
        <KpiCard
          key={kpi.label}
          label={kpi.label}
          value={kpi.value}
          icon={kpi.icon}
          accent={kpi.accent}
          caption={kpi.caption}
          compact={compact}
        />
      ))}
    </div>
  );
}
