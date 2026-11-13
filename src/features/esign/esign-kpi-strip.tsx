import { Check } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import type { KpiGridItem } from "@/components/dashboard/kpi-grid";
import { INTERACTIVE_TILE, SELECTED_TILE } from "@/lib/ui/tone-styles";
import { cn } from "@/lib/utils";

export type EsignDotKpi = {
  label: string;
  value: number;
  unit?: string;
  dotClass: string;
  /** Set when the dot is a filter toggle over the list beside it. */
  selected?: boolean;
  onClick?: () => void;
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
          selected={kpi.selected}
          onClick={kpi.onClick}
          href={kpi.href}
          empty={kpi.empty}
        />
      ))}
    </div>
  );
}

/** Screenshot KPI: a colored dot, the label, the number, and an optional unit line.
 *  Becomes a toggle button when `onClick` is set, so the strip filters the list below it. */
export function EsignDotKpis({ items }: { items: EsignDotKpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {items.map((item) => {
        const interactive = Boolean(item.onClick);
        const shell = cn(
          "relative rounded-xl border border-border bg-card px-4 py-3 text-start shadow-sm",
          interactive && INTERACTIVE_TILE,
          item.selected && SELECTED_TILE,
        );
        const body = (
          <>
            {item.selected ? (
              <span
                aria-hidden
                className="absolute end-2 top-2 inline-flex size-4 items-center justify-center rounded-full bg-orange-500 text-white shadow-sm"
              >
                <Check className="size-3" strokeWidth={3} />
              </span>
            ) : null}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", item.dotClass)} aria-hidden />
              {item.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums leading-none">{item.value}</p>
            {item.unit ? <p className="mt-1 text-xs text-muted-foreground">{item.unit}</p> : null}
          </>
        );
        if (item.onClick) {
          return (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              aria-pressed={Boolean(item.selected)}
              className={shell}
            >
              {body}
            </button>
          );
        }
        return (
          <div key={item.label} className={shell}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
