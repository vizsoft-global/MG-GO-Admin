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
  selected?: boolean;
  onClick?: () => void;
  /** Whole card links to the filtered view of this metric. */
  href?: string;
  /** Force the empty-widget shell when the metric is zero. */
  empty?: boolean;
};

/** Widest row the strip is allowed to form. Fewer KPIs than this must spread across the
 *  row instead of leaving a third of it empty and clipping their labels. */
/** Strips that must divide evenly at every width, so a narrow window cannot split
 *  them 5 + 3 and read as a broken row. The eight-card Performance Overview strip
 *  is the case: four and four below the desktop breakpoint, all eight above it. */
const EVEN_GRID: Record<number, string> = {
  8: "grid-cols-2 sm:grid-cols-4 lg:grid-cols-8",
};

const WIDE_COLUMNS: Record<number, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
  /* The Performance Overview strip is eight cards; they form one row, never 6 + 2. */
  8: "xl:grid-cols-8",
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
        EVEN_GRID[items.length] ?? "grid grid-cols-2 sm:grid-cols-3",
        !EVEN_GRID[items.length] && (WIDE_COLUMNS[items.length] ?? "xl:grid-cols-6"),
        "grid gap-2",
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
          selected={kpi.selected}
          onClick={kpi.onClick}
          href={kpi.href}
          empty={kpi.empty}
        />
      ))}
    </div>
  );
}
