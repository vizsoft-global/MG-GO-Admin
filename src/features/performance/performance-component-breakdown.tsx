"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Clock,
  Gauge,
  MapPin,
  Satellite,
  ShieldCheck,
  Timer,
  Timer as TimerIcon,
} from "lucide-react";
import { componentPct } from "./performance-formulas";
import type {
  PerformanceComponent,
  PerformanceComponentKey,
  PerformanceComponentScores,
} from "./performance-types";

const COMPONENT_ICON: Record<
  PerformanceComponentKey,
  React.ComponentType<{ className?: string }>
> = {
  punctuality: Clock,
  duty_ratio: TimerIcon,
  on_time: Timer,
  speed: Gauge,
  zone: MapPin,
  gps: Satellite,
  conduct: ShieldCheck,
};

/** Three bands, matching the driver bands so one page does not use two scales. */
function barClass(value: number): string {
  if (value >= 80) return "bg-emerald-500";
  if (value >= 50) return "bg-amber-500";
  return "bg-destructive";
}

export function componentLabel(
  component: PerformanceComponent,
  locale: string,
): string {
  return locale.startsWith("ar") ? component.label_ar : component.label_en;
}

/**
 * The compliance pillar, itemised.
 *
 * An unmeasured component is rendered as "no data" rather than as an empty bar:
 * an empty bar and a zero score look identical, and the blend treats them as
 * opposites — one is dropped, the other is the worst possible result.
 */
export function PerformanceComponentBreakdown({
  scores,
  components,
  compliance,
  className,
}: {
  scores: PerformanceComponentScores;
  components: PerformanceComponent[];
  compliance: number | null;
  className?: string;
}) {
  const t = useTranslations("pages.performance.components");
  const locale = useLocale();
  const active = components.filter((c) => c.is_active && c.weight > 0);

  if (active.length === 0) return null;

  return (
    <div className={`rounded-lg border border-border ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs font-medium">{t("title")}</p>
        <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
          {compliance == null ? t("unmeasured") : `${Math.round(compliance)}%`}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {active.map((component) => {
          const Icon = COMPONENT_ICON[component.key];
          const value = componentPct(scores, component.key);
          return (
            <li
              key={component.key}
              className="flex items-center gap-2 px-3 py-1.5"
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[11px]">
                {componentLabel(component, locale)}
              </span>
              <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
                {value == null ? null : (
                  <div
                    className={`h-full rounded-full ${barClass(value)}`}
                    style={{ width: `${value}%` }}
                  />
                )}
              </div>
              <span className="w-12 shrink-0 text-end text-[11px] font-semibold tabular-nums">
                {value == null ? (
                  <span
                    className="text-muted-foreground"
                    title={t("unmeasuredHint")}
                  >
                    {t("unmeasured")}
                  </span>
                ) : (
                  `${Math.round(value)}%`
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="px-3 py-1.5 text-[10px] text-muted-foreground">
        {t("hint")}
      </p>
    </div>
  );
}
