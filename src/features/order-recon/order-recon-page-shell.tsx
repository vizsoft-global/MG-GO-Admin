"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarDays, Download, Loader2, Upload, UserX, Users } from "lucide-react";
import { AppListCard } from "@/components/app/app-list-card";
import { AppPage } from "@/components/app/app-page";
import { AppPageHeader } from "@/components/app/app-page-header";
import { ToggleChip } from "@/components/app/toggle-chip";
import { ClearAllModuleButton } from "@/features/settings/clear-all-module-button";
import { KpiGrid } from "@/components/dashboard/kpi-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/query/query-keys";
import { useAuth } from "@/contexts/auth-context";
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { cn } from "@/lib/utils";
import { getOrderComparison } from "./order-comparison-actions";
import { applyPageFilters, activeFilterEntries, filterChipLabel } from "./order-comparison-filters";
import {
  buildComparisonRiders,
  comparisonKpis,
  comparisonPeriod,
  dailyTotals,
  daysInRange,
  fileMonthStamp,
  formatPct,
  monthContaining,
  monthLabelEn,
  RESULT_TONE,
  ridersInBoth,
  ridersMggoOnly,
  ridersNotUsingApp,
  spanDays,
  type ComparisonPeriodPreset,
  type ComparisonResult,
} from "./order-comparison-model";
import type { ComparisonColumnFilters } from "./order-comparison-filters";
import { ComparisonDayGrid, ComparisonSimpleTable } from "./order-comparison-grid";
import { OrderReconImportDialog } from "./order-recon-import-dialog";

type Tab = "both" | "unused" | "unmatched";

export function OrderReconPageShell() {
  const t = useTranslations("pages.orderRecon");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("order_recon.manage");
  const today = kuwaitTodayYmd();
  const lastMonth = comparisonPeriod("lastMonth", today);

  const [preset, setPreset] = useState<ComparisonPeriodPreset>("thisMonth");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [appliedCustom, setAppliedCustom] = useState({ from: today, to: today });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("both");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [dayIndex, setDayIndex] = useState<number | null>(null);
  const [columns, setColumns] = useState<ComparisonColumnFilters>({});
  const [pending, startTransition] = useTransition();

  const range = comparisonPeriod(preset, today, appliedCustom);
  const overSpan = spanDays(range.from, range.to) > 93;

  const query = useQuery({
    queryKey: queryKeys.orderRecon.comparison(range.from, range.to),
    queryFn: async () => {
      const res = await getOrderComparison({ from: range.from, to: range.to });
      if ("error" in res) throw new Error(res.error);
      return res.snapshot;
    },
    enabled: !overSpan,
  });

  const days = useMemo(() => daysInRange(range.from, range.to), [range.from, range.to]);
  const riders = useMemo(
    () => (query.data ? buildComparisonRiders(query.data, days) : []),
    [query.data, days],
  );
  const kpi = useMemo(() => comparisonKpis(riders), [riders]);
  const daily = useMemo(() => dailyTotals(riders, days), [riders, days]);
  const filtered = useMemo(
    () => applyPageFilters(riders, { search, result, dayIndex, columns }),
    [riders, search, result, dayIndex, columns],
  );

  const both = useMemo(() => ridersInBoth(filtered), [filtered]);
  const unused = useMemo(() => ridersNotUsingApp(filtered), [filtered]);
  const unmatched = useMemo(() => ridersMggoOnly(filtered), [filtered]);
  const monthMeta = monthContaining(range.from);
  const monthName =
    locale === "ar"
      ? new Intl.DateTimeFormat("ar", { month: "long", year: "numeric", timeZone: "UTC" }).format(
          new Date(`${monthMeta.from}T00:00:00Z`),
        )
      : monthLabelEn(monthMeta.year, monthMeta.month);

  const chips = activeFilterEntries(columns);
  const colLabels: Record<string, string> = {
    mgId: t("colMgId"),
    name: t("colRiderName"),
    restaurant: t("colRestaurant"),
    offDays: t("colDaysDiff"),
    am: t("colAm"),
    mggo: t("colMggo"),
    diff: t("colDiff"),
    workedDays: t("colDaysWithOrders"),
  };

  const onDownloadReport = () => {
    startTransition(async () => {
      const xlsx = await import("./order-comparison-xlsx");
      const monthDays = daysInRange(monthMeta.from, monthMeta.to);
      const sameMonth = range.from === monthMeta.from && range.to === monthMeta.to;
      let monthRiders = riders;
      if (!sameMonth) {
        const res = await getOrderComparison({ from: monthMeta.from, to: monthMeta.to });
        if ("error" in res) return;
        monthRiders = buildComparisonRiders(res.snapshot, monthDays);
      }
      const buf = await xlsx.buildComparisonWorkbook(monthRiders, monthDays, monthMeta.year, monthMeta.month);
      xlsx.downloadBuffer(buf, xlsx.comparisonWorkbookName(monthMeta.year, monthMeta.month));
    });
  };

  const onDownloadUnused = () => {
    startTransition(async () => {
      const xlsx = await import("./order-comparison-xlsx");
      const buf = await xlsx.buildUnusedWorkbook(unused, monthMeta.year, monthMeta.month);
      xlsx.downloadBuffer(buf, xlsx.unusedWorkbookName(monthMeta.year, monthMeta.month));
    });
  };

  const onFilteredCsv = () => {
    startTransition(async () => {
      const xlsx = await import("./order-comparison-xlsx");
      const source = tab === "unused" ? unused : tab === "unmatched" ? unmatched : both;
      xlsx.downloadCsvFile(
        xlsx.filteredCsvName(monthMeta.year, monthMeta.month),
        xlsx.buildFilteredCsv(source, days),
      );
    });
  };

  const lastMonthLabel =
    locale === "ar"
      ? new Intl.DateTimeFormat("ar", { month: "long", year: "numeric", timeZone: "UTC" }).format(
          new Date(`${lastMonth.from}T00:00:00Z`),
        )
      : monthLabelEn(monthContaining(lastMonth.from).year, monthContaining(lastMonth.from).month);

  return (
    <AppPage>
      <AppPageHeader
        title={t("compareTitle")}
        description={t("matchNote")}
        actions={
          <div className="flex flex-wrap gap-2">
            <ClearAllModuleButton entity="order_recon" />
            {canManage ? (
              <Button type="button" variant="outline" className="h-9 cursor-pointer" onClick={() => setOpen(true)}>
                <Upload className="size-4" />
                {t("uploadAm")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="h-9 cursor-pointer"
              disabled={filtered.length === 0}
              onClick={onFilteredCsv}
            >
              <Download className="size-4" />
              {t("filteredCsv")}
            </Button>
            <Button
              type="button"
              className="h-9 cursor-pointer"
              disabled={!query.data || pending}
              title={t("reportMonthHint", { month: fileMonthStamp(monthMeta.year, monthMeta.month) })}
              onClick={onDownloadReport}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {t("downloadReport")}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <ToggleChip selected={preset === "thisMonth"} className="h-9" onClick={() => setPreset("thisMonth")}>
          {t("periodThisMonth")}
        </ToggleChip>
        <ToggleChip selected={preset === "lastMonth"} className="h-9" onClick={() => setPreset("lastMonth")}>
          {lastMonthLabel}
        </ToggleChip>
        <ToggleChip selected={preset === "custom"} className="h-9" onClick={() => setPreset("custom")}>
          {t("periodCustom")}
        </ToggleChip>
        {preset === "custom" ? (
          <>
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9 w-36" />
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9 w-36" />
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => setAppliedCustom({ from: customFrom, to: customTo })}
            >
              {t("applyRange")}
            </Button>
          </>
        ) : null}
        <p className="text-[10px] text-muted-foreground">{t("matchNote")}</p>
      </div>

      {overSpan ? (
        <p className="text-sm text-destructive">{t("errors.range_too_large")}</p>
      ) : query.isLoading ? (
        <div className="flex justify-center p-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : query.isError ? (
        <p className="text-sm text-destructive">{t("errors.compare_failed")}</p>
      ) : (
        <>
          <KpiGrid
            compact
            items={[
              { label: t("kpiRiders"), value: kpi.riders },
              { label: t("kpiAm"), value: kpi.am },
              { label: t("kpiMggo"), value: kpi.mggo },
              { label: t("kpiNet"), value: kpi.net },
              { label: t("kpiMatches"), value: kpi.matches },
              { label: t("kpiMatchRate"), value: formatPct(kpi.matchRate) },
            ]}
          />

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            {kpi.cards.map((card) => {
              const tone = RESULT_TONE[card.result];
              const selected = result === card.result;
              return (
                <button
                  key={card.result}
                  type="button"
                  onClick={() => setResult(selected ? null : card.result)}
                  className={cn(
                    "rounded-xl border p-3 text-start shadow-sm",
                    selected
                      ? "border-emerald-500 ring-1 ring-emerald-400/50"
                      : "border-border bg-card",
                  )}
                  style={!selected ? { backgroundColor: tone.bg, color: tone.fg } : undefined}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide">{t(`result.${card.result}`)}</p>
                  <p className="text-lg font-semibold">{card.count}</p>
                  <p className="text-[10px]">
                    {formatPct(card.share)} · AM {card.am} · MGGO {card.mggo}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold">{t("chartDailyOrders")}</h3>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={daily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip />
                  <Line type="monotone" dataKey="am" name="AM" stroke="#2c44b8" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="mggo" name="MGGO" stroke="#087f5b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold">{t("chartDailyDiff")}</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={daily} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={36} />
                  <Tooltip />
                  <Bar
                    dataKey="diff"
                    name="AM − MGGO"
                    fill="#6f8cee"
                    cursor="pointer"
                    onClick={(_, i) => setDayIndex(dayIndex === i ? null : i)}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ToggleChip selected={tab === "both"} icon={Users} className="h-9" onClick={() => setTab("both")}>
              {t("tabBoth")}
            </ToggleChip>
            <ToggleChip selected={tab === "unused"} icon={UserX} className="h-9" onClick={() => setTab("unused")}>
              {t("tabUnused")}
            </ToggleChip>
            <ToggleChip selected={tab === "unmatched"} icon={CalendarDays} className="h-9" onClick={() => setTab("unmatched")}>
              {t("tabUnmatched")}
            </ToggleChip>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchRiders")}
              className="h-9 w-56"
            />
            {dayIndex != null ? (
              <button type="button" className="h-8 rounded-md border border-border px-2 text-[11px]" onClick={() => setDayIndex(null)}>
                {t("clearDay", { day: days[dayIndex]?.slice(8) ?? "" })}
              </button>
            ) : null}
          </div>

          {chips.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip.id}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-muted/40 px-2 text-[11px]"
                >
                  {filterChipLabel(chip.id, chip.value, colLabels)}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      const next = { ...columns };
                      delete next[chip.id];
                      setColumns(next);
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <button type="button" className="h-7 text-[11px] text-primary" onClick={() => setColumns({})}>
                {t("clearColumnFilters")}
              </button>
            </div>
          ) : null}

          {tab === "unused" ? (
            <AppListCard
              toolbar={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-amber-800">{t("unusedBanner")}</p>
                  <Button type="button" variant="outline" className="h-9" onClick={onDownloadUnused} disabled={unused.length === 0}>
                    <Download className="size-4" />
                    {t("downloadUnused")}
                  </Button>
                </div>
              }
            >
              <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {t("unusedFooter", { riders: unused.length, orders: unused.reduce((s, r) => s + r.am, 0) })}
              </div>
              {unused.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">{t("emptyRows")}</p>
              ) : (
                <ComparisonSimpleTable riders={unused} mode="unused" />
              )}
            </AppListCard>
          ) : tab === "unmatched" ? (
            <AppListCard>
              {unmatched.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">{t("emptyRows")}</p>
              ) : (
                <ComparisonSimpleTable riders={unmatched} mode="mggo_only" />
              )}
            </AppListCard>
          ) : (
            <AppListCard>
              {both.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">{t("emptyRows")}</p>
              ) : (
                <ComparisonDayGrid
                  riders={both}
                  days={days}
                  monthLabel={monthName}
                  filters={columns}
                  onFilters={setColumns}
                  labels={{
                    mgId: t("colMgId"),
                    name: t("colRiderName"),
                    restaurant: t("colRestaurant"),
                    month: t("colMonth"),
                    days: t("colDaysDiff"),
                    search: t("searchRiders"),
                    searchMgId: t("searchMgId"),
                    searchName: t("searchName"),
                    searchRestaurant: t("searchRestaurant"),
                    all: t("filterAll"),
                    clear: t("filterClear"),
                    apply: t("filterApply"),
                    min: t("filterMin"),
                    max: t("filterMax"),
                    contains: t("filterContains"),
                  }}
                />
              )}
            </AppListCard>
          )}
        </>
      )}

      <OrderReconImportDialog open={open} onOpenChange={setOpen} />
    </AppPage>
  );
}
