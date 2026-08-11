import { KpiCard } from "@/components/dashboard/kpi-card";
import type { KpiGridItem } from "@/components/dashboard/kpi-grid";

/** Four-up KPI strip for the e-sign lists (Figma ESign 01 / 02): the shared `KpiGrid` is a
 *  six-column strip, so four items leave a third of the row empty and truncate the labels. */
export function EsignKpiStrip({ items }: { items: KpiGridItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map((kpi) => (
        <KpiCard
          key={kpi.label}
          label={kpi.label}
          value={kpi.value}
          icon={kpi.icon}
          accent={kpi.accent}
          caption={kpi.caption}
        />
      ))}
    </div>
  );
}
