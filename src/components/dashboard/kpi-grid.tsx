import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { KpiCard, type KpiAccent } from "@/components/dashboard/kpi-card";
import { cn } from "@/lib/utils";

export type KpiGridItem = {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  accent?: KpiAccent;
  caption?: ReactNode;
};

/** Widest row the strip is allowed to form. Fewer KPIs than this must spread across the
 *  row instead of leaving a third of it empty and clipping their labels. */
const WIDE_COLUMNS: Record<number, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
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
    <div
      className={cn(
        "grid grid-cols-2 gap-2 sm:grid-cols-3",
        WIDE_COLUMNS[items.length] ?? "xl:grid-cols-6",
      )}
    >
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
