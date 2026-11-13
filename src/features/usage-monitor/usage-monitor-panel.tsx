"use client";

import { useMemo, useSyncExternalStore, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw } from "lucide-react";

import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { InfoNote } from "@/components/app/info-note";
import { SectionCard } from "@/components/app/section-card";
import { StatTile } from "@/components/app/stat-tile";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import {
  getCloudflareUsage,
  type CloudflareOverview,
  type CloudflareOverviewResult,
} from "./cloudflare-actions";
import { forecastCloudflareMonthly, type CloudflareMonthly } from "./cloudflare-forecast";
import { CloudflareSection } from "./cloudflare-section";
import { getUsageOverview, type UsageOverview, type UsageOverviewResult } from "./usage-actions";
import { UsageColumns } from "./usage-columns";
import {
  DEFAULT_USAGE_RATES,
  USAGE_RATE_KEYS,
  USAGE_WINDOWS,
  forecastMonthly,
  rebucket,
  sanitizeRates,
  windowTotals,
  type MonthlyForecast,
  type UsageRates,
  type UsageWindowKey,
  type WindowTotals,
  type WindowUsage,
} from "./usage-forecast";

const REFRESH_MS = 60_000;
const RATES_KEY = "usage-monitor:rates:v1";
/** The owner's ceiling for Firebase and Cloudflare together. */
const TARGET_USD = 100;
const CHART_BUCKET_MS = 15 * 60_000;
const CHART_BUCKETS = 96;

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const CLOCK = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kuwait",
});

function formatClock(ms: number): string {
  return CLOCK.format(new Date(ms));
}

/**
 * The price assumptions live in this browser's storage, read through
 * `useSyncExternalStore` so the server render and the first client render agree
 * (both see the defaults) and a second tab picks up an edit.
 */
const RATES_EVENT = "usage-monitor:rates";
const QUERY_KEY = ["usage-monitor", "overview"] as const;
const CLOUDFLARE_QUERY_KEY = ["usage-monitor", "cloudflare"] as const;
/** Cloudflare's analytics move slower than a minute; asking twice as rarely loses nothing. */
const CLOUDFLARE_REFRESH_MS = 120_000;

function subscribeRates(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(RATES_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(RATES_EVENT, onChange);
  };
}

function storedRatesSnapshot(): string {
  try {
    return window.localStorage.getItem(RATES_KEY) ?? "";
  } catch {
    return "";
  }
}

function serverRatesSnapshot(): string {
  return "";
}

function parseRates(raw: string): UsageRates {
  if (!raw) return { ...DEFAULT_USAGE_RATES };
  try {
    return sanitizeRates(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_USAGE_RATES };
  }
}

function storeRates(rates: UsageRates | null): void {
  try {
    if (rates) window.localStorage.setItem(RATES_KEY, JSON.stringify(rates));
    else window.localStorage.removeItem(RATES_KEY);
  } catch {
    // The page works without storage; the rates just reset on the next visit.
  }
  window.dispatchEvent(new Event(RATES_EVENT));
}

type UsageRowKey =
  | "reads"
  | "writes"
  | "deletes"
  | "ttlDeletes"
  | "billedReadUnits"
  | "billedWriteUnits"
  | "invocations"
  | "vcpuSeconds"
  | "gibSeconds";

const USAGE_ROWS: readonly UsageRowKey[] = [
  "reads",
  "writes",
  "deletes",
  "ttlDeletes",
  "billedReadUnits",
  "billedWriteUnits",
  "invocations",
  "vcpuSeconds",
  "gibSeconds",
];

const COST_LINES = ["reads", "writes", "deletes", "invocations", "compute"] as const;

function totalsOf(overview: UsageOverview): Record<UsageRowKey, WindowTotals> {
  const out = {} as Record<UsageRowKey, WindowTotals>;
  for (const key of USAGE_ROWS) out[key] = windowTotals(overview[key].points, overview.endMs);
  return out;
}

export function UsageMonitorPanel() {
  const t = useTranslations("pages.settings.usageMonitor");
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();

  // React Query owns the minute poll: it pauses while the tab is hidden, so a
  // monitor left open in the background asks Google for nothing.
  const query = useQuery<UsageOverviewResult>({
    queryKey: QUERY_KEY,
    queryFn: () => getUsageOverview(false),
    refetchInterval: REFRESH_MS,
    staleTime: 0,
  });
  const result = query.data;
  const overview: UsageOverview | null = result && !("error" in result) ? result : null;
  const error =
    result && "error" in result
      ? { code: result.error, email: result.serviceAccountEmail }
      : query.isError
        ? { code: "monitoring_failed", email: undefined }
        : null;
  const loading = query.isPending;

  // Separate query on purpose: a Cloudflare token problem must not blank Firebase.
  const cloudflareQuery = useQuery<CloudflareOverviewResult>({
    queryKey: CLOUDFLARE_QUERY_KEY,
    queryFn: () => getCloudflareUsage(false),
    refetchInterval: CLOUDFLARE_REFRESH_MS,
    staleTime: 0,
  });
  const cloudflareResult = cloudflareQuery.data;
  const cloudflare: CloudflareOverview | null =
    cloudflareResult && !("error" in cloudflareResult) ? cloudflareResult : null;
  const cloudflareError =
    cloudflareResult && "error" in cloudflareResult
      ? cloudflareResult.error
      : cloudflareQuery.isError
        ? "cloudflare_failed"
        : null;

  const cloudflareForecasts = useMemo(() => {
    if (!cloudflare) return null;
    const out = {} as Record<UsageWindowKey, CloudflareMonthly>;
    for (const { key, hours } of USAGE_WINDOWS) {
      out[key] = forecastCloudflareMonthly(cloudflare.windows[key], hours, cloudflare.storageBytes);
    }
    return out;
  }, [cloudflare]);

  const ratesRaw = useSyncExternalStore(subscribeRates, storedRatesSnapshot, serverRatesSnapshot);
  const rates = useMemo(() => parseRates(ratesRaw), [ratesRaw]);

  const handleRefresh = () => {
    startTransition(async () => {
      const [fresh, freshCloudflare] = await Promise.all([
        getUsageOverview(true),
        getCloudflareUsage(true),
      ]);
      queryClient.setQueryData(QUERY_KEY, fresh);
      queryClient.setQueryData(CLOUDFLARE_QUERY_KEY, freshCloudflare);
    });
  };

  const updateRate = (key: keyof UsageRates, raw: string) => {
    storeRates(sanitizeRates({ ...rates, [key]: raw === "" ? 0 : raw }));
  };

  const resetRates = () => {
    storeRates(null);
  };

  const totals = useMemo(() => (overview ? totalsOf(overview) : null), [overview]);

  /** Enterprise bills units; when the project reports them they are the cost basis. */
  const billsUnits = (totals?.billedReadUnits.h24 ?? 0) > 0;

  const forecasts = useMemo(() => {
    if (!totals) return null;
    const out = {} as Record<UsageWindowKey, MonthlyForecast>;
    for (const { key, hours } of USAGE_WINDOWS) {
      const usage: WindowUsage = {
        reads: billsUnits ? totals.billedReadUnits[key] : totals.reads[key],
        writes:
          billsUnits && totals.billedWriteUnits.h24 > 0
            ? totals.billedWriteUnits[key]
            : totals.writes[key],
        deletes: totals.deletes[key],
        ttlDeletes: totals.ttlDeletes[key],
        invocations: totals.invocations[key],
        vcpuSeconds: totals.vcpuSeconds[key],
        gibSeconds: totals.gibSeconds[key],
      };
      out[key] = forecastMonthly(usage, hours, rates);
    }
    return out;
  }, [totals, billsUnits, rates]);

  const readChart = useMemo(
    () =>
      overview
        ? rebucket(overview.reads.points, overview.endMs, CHART_BUCKET_MS, CHART_BUCKETS)
        : [],
    [overview],
  );
  const writeChart = useMemo(
    () =>
      overview
        ? rebucket(overview.writes.points, overview.endMs, CHART_BUCKET_MS, CHART_BUCKETS)
        : [],
    [overview],
  );

  const failedLines = overview
    ? USAGE_ROWS.filter((key) => overview[key].error).map((key) => t(`rows.${key}`))
    : [];
  const functionsTotal24 = totals?.invocations.h24 ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {overview ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {t("dataTo", { time: formatClock(overview.endMs) })}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-9 cursor-pointer rounded-lg"
            disabled={isPending || loading}
            onClick={handleRefresh}
          >
            {isPending || loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("refresh")}
          </Button>
        </div>
      </div>

      {error ? (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          <p className="font-medium">{t(`errors.${error.code}`)}</p>
          {error.code === "permission_denied" && error.email ? (
            <p className="mt-1 text-xs">{t("permissionHelp", { email: error.email })}</p>
          ) : null}
        </div>
      ) : null}

      {failedLines.length > 0 ? (
        <InfoNote>{t("partial", { list: failedLines.join(", ") })}</InfoNote>
      ) : null}

      {overview && totals && forecasts ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {USAGE_WINDOWS.map(({ key }) => {
              const firebase = forecasts[key].total;
              const total = firebase + (cloudflareForecasts?.[key].total ?? 0);
              const over = total > TARGET_USD;
              return (
                <div key={key} className="relative">
                  <StatTile
                    label={t(`forecast.tile.${key}`)}
                    value={USD.format(total)}
                    delta={
                      cloudflareForecasts
                        ? t("forecast.split", {
                            firebase: USD.format(firebase),
                            cloudflare: USD.format(cloudflareForecasts[key].total),
                          })
                        : t("forecast.firebaseOnly")
                    }
                    className="h-full"
                  />
                  <span className="absolute end-3 top-3 inline-flex items-center gap-1">
                    {over ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-[var(--status-absent-fg)]" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-[var(--status-working-fg)]" />
                    )}
                    <StatusBadge
                      status={over ? "absent" : "working"}
                      label={over ? t("forecast.over") : t("forecast.under")}
                    />
                  </span>
                </div>
              );
            })}
            <StatTile
              label={t("forecast.target")}
              value={USD.format(TARGET_USD)}
              delta={t("forecast.targetNote")}
              className="h-full"
            />
          </div>

          <h2 className="pt-1 text-sm font-semibold text-foreground">{t("headings.firebase")}</h2>
          <InfoNote>{billsUnits ? t("basis.units") : t("basis.documents")}</InfoNote>

          <div className="grid gap-3 lg:grid-cols-2 lg:items-stretch">
            <SectionCard title={t("usage.title")} className="h-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("usage.metric")}</TableHead>
                    {USAGE_WINDOWS.map(({ key }) => (
                      <TableHead key={key} className={cn(TABLE_HEAD_CLASS, "text-end")}>
                        {t(`usage.${key}`)}
                      </TableHead>
                    ))}
                    <TableHead className={cn(TABLE_HEAD_CLASS, "text-end")}>
                      {t("usage.perDay")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {USAGE_ROWS.map((key) => {
                    if (
                      (key === "billedReadUnits" || key === "billedWriteUnits") &&
                      totals[key].h24 === 0
                    ) {
                      return null;
                    }
                    return (
                      <TableRow key={key}>
                        <TableCell className="text-sm">{t(`rows.${key}`)}</TableCell>
                        {USAGE_WINDOWS.map(({ key: windowKey }) => (
                          <TableCell key={windowKey} className="text-end text-sm tabular-nums">
                            {NUMBER.format(totals[key][windowKey])}
                          </TableCell>
                        ))}
                        <TableCell className="text-end text-sm tabular-nums text-muted-foreground">
                          {COMPACT.format(totals[key].h1 * 24)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="mt-2 text-[10px] text-muted-foreground">{t("usage.perDayNote")}</p>
            </SectionCard>

            <SectionCard title={t("forecast.title")} className="h-full">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("forecast.line")}</TableHead>
                    {USAGE_WINDOWS.map(({ key }) => (
                      <TableHead key={key} className={cn(TABLE_HEAD_CLASS, "text-end")}>
                        {t(`forecast.at.${key}`)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {COST_LINES.map((line) => (
                    <TableRow key={line}>
                      <TableCell className="text-sm">{t(`forecast.lines.${line}`)}</TableCell>
                      {USAGE_WINDOWS.map(({ key }) => (
                        <TableCell key={key} className="text-end text-sm tabular-nums">
                          {USD.format(forecasts[key][line])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="text-sm font-semibold">{t("forecast.total")}</TableCell>
                    {USAGE_WINDOWS.map(({ key }) => (
                      <TableCell key={key} className="text-end text-sm font-semibold tabular-nums">
                        {USD.format(forecasts[key].total)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
              <p className="mt-2 text-[10px] text-muted-foreground">{t("forecast.note")}</p>
            </SectionCard>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <SectionCard title={t("charts.reads")}>
              <UsageColumns
                points={readChart}
                formatValue={(value) => NUMBER.format(value)}
                formatTime={formatClock}
                peakLabel={t("charts.peak")}
                emptyLabel={t("charts.none")}
              />
            </SectionCard>
            <SectionCard title={t("charts.writes")}>
              <UsageColumns
                points={writeChart}
                formatValue={(value) => NUMBER.format(value)}
                formatTime={formatClock}
                peakLabel={t("charts.peak")}
                emptyLabel={t("charts.none")}
              />
            </SectionCard>
          </div>

          <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
            <SectionCard
              title={t("functions.title")}
              action={
                <span className="text-xs text-muted-foreground">
                  {t("functions.count", { count: overview.functionCount })}
                </span>
              }
            >
              {overview.functions.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  {t("functions.empty")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={TABLE_HEAD_CLASS}>{t("functions.name")}</TableHead>
                      {USAGE_WINDOWS.map(({ key }) => (
                        <TableHead key={key} className={cn(TABLE_HEAD_CLASS, "text-end")}>
                          {t(`usage.${key}`)}
                        </TableHead>
                      ))}
                      <TableHead className={cn(TABLE_HEAD_CLASS, "text-end")}>
                        {t("functions.share")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.functions.map((row) => (
                      <TableRow key={row.name}>
                        <TableCell className="font-mono text-xs">{row.name}</TableCell>
                        <TableCell className="text-end text-sm tabular-nums">
                          {NUMBER.format(row.h1)}
                        </TableCell>
                        <TableCell className="text-end text-sm tabular-nums">
                          {NUMBER.format(row.h5)}
                        </TableCell>
                        <TableCell className="text-end text-sm tabular-nums">
                          {NUMBER.format(row.h24)}
                        </TableCell>
                        <TableCell className="text-end text-sm tabular-nums text-muted-foreground">
                          {functionsTotal24 > 0
                            ? `${((row.h24 / functionsTotal24) * 100).toFixed(1)}%`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionCard>

            <SectionCard
              title={t("rates.title")}
              action={
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 cursor-pointer rounded-lg"
                  onClick={resetRates}
                >
                  <RotateCcw className="h-4 w-4" />
                  {t("rates.reset")}
                </Button>
              }
            >
              <p className="mb-3 text-xs text-muted-foreground">{t("rates.description")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {USAGE_RATE_KEYS.map((key) => (
                  <label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {t(`rates.fields.${key}`)}
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      className="h-9 tabular-nums"
                      value={rates[key]}
                      onChange={(event) => updateRate(key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </SectionCard>
          </div>

          <h2 className="pt-1 text-sm font-semibold text-foreground">{t("headings.cloudflare")}</h2>
          {cloudflare && cloudflareForecasts ? (
            <CloudflareSection overview={cloudflare} forecasts={cloudflareForecasts} />
          ) : cloudflareError ? (
            <InfoNote>{t(`cloudflare.errors.${cloudflareError}`)}</InfoNote>
          ) : (
            <InfoNote>{t("cloudflare.loading")}</InfoNote>
          )}

          <p className="text-[10px] text-muted-foreground">
            {t("footer", {
              project: overview.projectId,
              time: formatClock(overview.generatedAt),
            })}
          </p>
        </>
      ) : loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      ) : null}
    </div>
  );
}
