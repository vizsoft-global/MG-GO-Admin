"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarRange,
  CalendarX,
  Gauge,
  Loader2,
  Package,
  ShieldAlert,
  Timer,
  Users,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppEmptyState } from "@/components/app";
import { ToggleChip } from "@/components/app/toggle-chip";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { Card, CardContent } from "@/components/ui/card";
import {
  kuwaitToday,
  performanceRange,
  PERFORMANCE_RANGE_PRESETS,
  type PerformanceRangePreset,
} from "./performance-formulas";
import { componentLabel } from "./performance-component-breakdown";
import {
  trendCoverageDiff,
  trendIsComparable,
  type PerformanceBandCounts,
  type PerformanceComponentKey,
  type PerformanceScoreBand,
  type PerformanceTrend,
  type PerformanceTrendBucket,
  type PerformanceTrendGroup,
} from "./performance-types";
import { usePerformanceTrend } from "./use-performance";
import { cn } from "@/lib/utils";

const BUCKETS: PerformanceTrendBucket[] = ["day", "week", "month"];

const BAND_ORDER: PerformanceScoreBand[] = ["top", "good", "watch", "critical"];

const BAND_BAR_CLASS: Record<PerformanceScoreBand, string> = {
  top: "bg-emerald-500",
  good: "bg-primary",
  watch: "bg-amber-500",
  critical: "bg-destructive",
};

/**
 * Deterministic per-component line colour. Not a palette lookup by index: a
 * component that goes unmeasured for a window would shift every colour after
 * it, so the same series would change colour between two windows of the same
 * chart.
 */
const COMPONENT_COLOR: Record<PerformanceComponentKey, string> = {
  punctuality: "#2563eb",
  duty_ratio: "#7c3aed",
  on_time: "#059669",
  speed: "#d97706",
  zone: "#dc2626",
  gps: "#0891b2",
  conduct: "#be185d",
};

function fmtScore(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(1);
}

/** A percentage-point move, signed. Null when either side has no score. */
function delta(now: number | null, prev: number | null): number | null {
  if (now == null || prev == null) return null;
  return Math.round((now - prev) * 10) / 10;
}

function DeltaChip({
  value,
  suppressed,
}: {
  value: number | null;
  suppressed?: boolean;
}) {
  const t = useTranslations("pages.performance.analysis");
  if (suppressed) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <ArrowRight className="size-3" />
        {t("deltaUnavailable")}
      </span>
    );
  }
  if (value == null) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  const up = value > 0;
  const flat = value === 0;
  const Icon = flat ? ArrowRight : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium",
        flat && "text-muted-foreground",
        !flat && up && "text-emerald-700",
        !flat && !up && "text-destructive",
      )}
    >
      <Icon className="size-3" />
      {up ? "+" : ""}
      {value}
    </span>
  );
}

/**
 * A share-of-total read, which a bar whose width IS the share states directly.
 * The same argument that kept the live tab's distribution card off a chart
 * library — this one just sits beside charts that earn theirs.
 */
function GroupBars({
  rows,
  emptyLabel,
  unassignedLabel,
  showRating,
}: {
  rows: PerformanceTrendGroup[];
  emptyLabel: string;
  unassignedLabel: string;
  showRating?: boolean;
}) {
  const scored = rows.filter((row) => row.score != null);
  if (scored.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-2">
      {scored.map((row) => (
        <div key={row.key ?? "__unassigned"} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium">
              {row.label || unassignedLabel}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {fmtScore(row.score)}
              {showRating && row.avg_rating != null
                ? ` · ★ ${row.avg_rating.toFixed(2)}`
                : ""}
              {` · ${row.drivers}`}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, row.score ?? 0))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function BandRow({
  label,
  counts,
}: {
  label: string;
  counts: PerformanceBandCounts;
}) {
  const total = BAND_ORDER.reduce((sum, band) => sum + counts[band], 0);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{total}</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {BAND_ORDER.map((band) =>
          counts[band] > 0 && total > 0 ? (
            <div
              key={band}
              className={BAND_BAR_CLASS[band]}
              style={{ width: `${(counts[band] / total) * 100}%` }}
              title={`${band}: ${counts[band]}`}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}

export function PerformanceAnalysisPanel() {
  const t = useTranslations("pages.performance.analysis");
  const tp = useTranslations("pages.performance");
  const locale = useLocale();
  const today = kuwaitToday();

  const [preset, setPreset] = useState<PerformanceRangePreset>("last30");
  const [bucket, setBucket] = useState<PerformanceTrendBucket>("day");
  const range = useMemo(() => performanceRange(preset, today), [preset, today]);

  const { data, isLoading, error } = usePerformanceTrend({
    fromDate: range.from,
    toDate: range.to,
    bucket,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <AppEmptyState
        title={t("errorTitle")}
        description={
          error instanceof Error && error.message === "not_authorized"
            ? t("errorForbidden")
            : t("errorHint")
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {PERFORMANCE_RANGE_PRESETS.map((option) => (
          <ToggleChip
            key={option}
            size="md"
            icon={CalendarRange}
            selected={preset === option}
            onClick={() => setPreset(option)}
          >
            {tp(`presets.${option}`)}
          </ToggleChip>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {BUCKETS.map((option) => (
          <ToggleChip
            key={option}
            size="md"
            selected={bucket === option}
            onClick={() => setBucket(option)}
          >
            {t(`bucket.${option}`)}
          </ToggleChip>
        ))}
      </div>

      <ComparabilityNotice trend={data} />

      <TrendKpis trend={data} />

      <div className="grid gap-2 lg:grid-cols-3 lg:items-stretch">
        <Card className="rounded-xl border-border shadow-sm lg:col-span-2">
          <CardContent className="flex h-full flex-col p-4">
            <p className="mb-2 text-sm font-semibold">{t("chartTitle")}</p>
            <TrendChart trend={data} locale={locale} />
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border shadow-sm">
          <CardContent className="flex h-full flex-col gap-3 p-4">
            <p className="text-sm font-semibold">{t("bandsTitle")}</p>
            <BandRow label={t("bandsCurrent")} counts={data.bands.current} />
            <BandRow label={t("bandsPrevious")} counts={data.bands.previous} />
            <div className="grid grid-cols-3 gap-2 pt-1">
              <MoveStat
                label={t("improved")}
                value={data.bands.improved}
                tone="up"
              />
              <MoveStat
                label={t("unchanged")}
                value={data.bands.unchanged}
                tone="flat"
              />
              <MoveStat
                label={t("declined")}
                value={data.bands.declined}
                tone="down"
              />
            </div>
            <p className="mt-auto text-[10px] leading-snug text-muted-foreground">
              {t("bandsHint")}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-2 lg:grid-cols-3 lg:items-stretch">
        <Card className="rounded-xl border-border shadow-sm">
          <CardContent className="flex h-full flex-col p-4">
            <p className="mb-2 text-sm font-semibold">{t("byZone")}</p>
            <GroupBars
              rows={data.by_zone}
              emptyLabel={t("noBreakdown")}
              unassignedLabel={t("unassigned")}
            />
          </CardContent>
        </Card>
        <Card className="rounded-xl border-border shadow-sm">
          <CardContent className="flex h-full flex-col p-4">
            <p className="mb-2 text-sm font-semibold">{t("byPartner")}</p>
            <GroupBars
              rows={data.by_partner}
              emptyLabel={t("noBreakdown")}
              unassignedLabel={t("unassigned")}
            />
          </CardContent>
        </Card>
        <Card className="rounded-xl border-border shadow-sm">
          <CardContent className="flex h-full flex-col p-4">
            <p className="text-sm font-semibold">{t("byTeam")}</p>
            <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
              {t("byTeamHint")}
            </p>
            <GroupBars
              rows={data.by_team}
              emptyLabel={t("noRatings")}
              unassignedLabel={t("unassigned")}
              showRating
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MoveStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "up" | "flat" | "down";
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-2 py-1.5 text-center">
      <p
        className={cn(
          "text-base font-semibold tabular-nums",
          tone === "up" && "text-emerald-700",
          tone === "down" && "text-destructive",
          tone === "flat" && "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * The one thing this tab must never do is present a change of blend as a change
 * of performance. When the two halves measured different components the deltas
 * are withheld rather than shown with an asterisk — a number on screen gets
 * quoted regardless of the caveat beside it.
 */
function ComparabilityNotice({ trend }: { trend: PerformanceTrend }) {
  const t = useTranslations("pages.performance.analysis");
  const locale = useLocale();
  const comparable = trendIsComparable(trend);
  if (comparable) return null;

  const { added, removed } = trendCoverageDiff(trend);
  const name = (key: PerformanceComponentKey) => {
    const meta = trend.components.find((c) => c.key === key);
    return meta ? componentLabel(meta, locale) : key;
  };
  const parts = [
    added.length ? t("coverageAdded", { list: added.map(name).join(", ") }) : null,
    removed.length
      ? t("coverageRemoved", { list: removed.map(name).join(", ") })
      : null,
  ].filter(Boolean);

  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-0.5">
        <p className="text-xs font-semibold">{t("coverageTitle")}</p>
        <p className="text-[11px] leading-snug">
          {t("coverageBody")} {parts.join(" ")}
        </p>
      </div>
    </div>
  );
}

function TrendKpis({ trend }: { trend: PerformanceTrend }) {
  const t = useTranslations("pages.performance.analysis");
  const now = trend.totals;
  const prev = trend.previous_totals;
  const suppressed = !trendIsComparable(trend);

  return (
    <KpiGrid
      compact
      items={[
        {
          label: t("kpiScore"),
          value: fmtScore(now.score),
          icon: Gauge,
          accent: "primary",
          // The score is the only KPI whose delta is withheld when the halves
          // are not comparable. The counts beside it — drivers, deliveries,
          // absences — are raw sums that mean the same thing whatever the blend
          // measured, so suppressing those too would hide facts to protect a
          // caveat that does not apply to them.
          caption: (
            <DeltaChip
              value={delta(now.score, prev.score)}
              suppressed={suppressed}
            />
          ),
        },
        {
          label: t("kpiDrivers"),
          value: now.drivers,
          icon: Users,
          caption: <DeltaChip value={delta(now.drivers, prev.drivers)} />,
        },
        {
          label: t("kpiDeliveries"),
          value: now.deliveries,
          icon: Package,
          caption: <DeltaChip value={delta(now.deliveries, prev.deliveries)} />,
        },
        {
          label: t("kpiSla"),
          value: now.sla_rate == null ? "—" : `${now.sla_rate}%`,
          icon: Timer,
          caption: <DeltaChip value={delta(now.sla_rate, prev.sla_rate)} />,
        },
        {
          label: t("kpiAbsent"),
          value: now.absent_days,
          icon: CalendarX,
          accent: now.absent_days > prev.absent_days ? "warning" : "default",
          caption: <DeltaChip value={delta(now.absent_days, prev.absent_days)} />,
        },
        {
          label: t("kpiConduct"),
          value: now.conduct_weighted,
          icon: ShieldAlert,
          accent: now.conduct_weighted > 0 ? "warning" : "default",
          caption: (
            <DeltaChip
              value={delta(now.conduct_weighted, prev.conduct_weighted)}
            />
          ),
        },
      ]}
    />
  );
}

function TrendChart({
  trend,
  locale,
}: {
  trend: PerformanceTrend;
  locale: string;
}) {
  const t = useTranslations("pages.performance.analysis");

  // Only components that actually produced a point are drawn. A legend entry
  // whose line is absent reads as a rendering failure rather than as no data.
  const series = useMemo(
    () =>
      trend.components.filter((component) =>
        trend.series.some((point) => point.components[component.key] != null),
      ),
    [trend.components, trend.series],
  );

  const rows = useMemo(
    () =>
      trend.series.map((point) => {
        const row: Record<string, string | number | null> = {
          bucket: point.bucket,
          score: point.score,
        };
        for (const component of trend.components) {
          const value = point.components[component.key];
          row[component.key] = value == null ? null : Math.round(value * 1000) / 10;
        }
        return row;
      }),
    [trend.components, trend.series],
  );

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-xs text-muted-foreground">
        {t("noSeries")}
      </p>
    );
  }

  return (
    <div className="h-[min(320px,36dvh)] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="bucket"
            tick={{ fontSize: 10 }}
            tickMargin={6}
            minTickGap={24}
          />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={40} />
          <Tooltip
            contentStyle={{ fontSize: 11, borderRadius: 8 }}
            formatter={(value) =>
              typeof value === "number" ? value.toFixed(1) : String(value ?? "—")
            }
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line
            type="monotone"
            dataKey="score"
            name={t("seriesBlend")}
            stroke="#0f172a"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          {series.map((component) => (
            <Line
              key={component.key}
              type="monotone"
              dataKey={component.key}
              name={componentLabel(component, locale)}
              stroke={COMPONENT_COLOR[component.key]}
              strokeWidth={1.25}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
