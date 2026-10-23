import { KpiCard } from "@/components/dashboard/kpi-card";
import type { KpiGridItem } from "@/components/dashboard/kpi-grid";
import { cn } from "@/lib/utils";

export type EsignDotKpi = {
  label: string;
  value: number;
  unit?: string;
  dotClass: string;
};

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

/** Screenshot KPI: a colored dot, the label, the number, and an optional unit line. */
export function EsignDotKpis({ items }: { items: EsignDotKpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", item.dotClass)} aria-hidden />
            {item.label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums leading-none">{item.value}</p>
          {item.unit ? <p className="mt-1 text-xs text-muted-foreground">{item.unit}</p> : null}
        </div>
      ))}
    </div>
  );
}
