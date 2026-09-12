"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Settings2 } from "lucide-react";
import { AppEmptyState, AppPage, AppPageHeader } from "@/components/app";
import { LAYOUT } from "@/components/app/layout-spacing";
import { TabBar } from "@/components/dashboard/tab-bar";
import { Link } from "@/i18n/navigation";
import { kuwaitToday } from "./performance-formulas";
import {
  assertOpsRange,
  resolveOpsRange,
  type OpsGranularity,
  type OpsRangePreset,
} from "./performance-ops-formulas";
import { downloadCsv, toCsv } from "./performance-ops-table";
import {
  EMPTY_OPS_SLICERS,
  type PerformanceHubTab,
  type OpsSlicers,
} from "./performance-ops-types";
import { enrichOpsRider } from "./performance-ops-format";
import { usePerformanceOpsBounds, usePerformanceOpsSnapshot } from "./use-performance";
import { OpsGranularityPills, OpsRangePills, OpsSlicerBar } from "./ops/ops-chrome";
import { OpsOverviewTab } from "./ops/ops-overview-tab";
import { OpsDpdTab } from "./ops/ops-dpd-tab";
import { OpsRidersTab } from "./ops/ops-riders-tab";
import { OpsTopBottomTab } from "./ops/ops-top-bottom-tab";
import { OpsOutsourceTab } from "./ops/ops-outsource-tab";
import { cn } from "@/lib/utils";

export function PerformancePageShell() {
  const t = useTranslations("pages.performance");
  const todayFallback = kuwaitToday();

  const [tab, setTab] = useState<PerformanceHubTab>("overview");
  const [preset, setPreset] = useState<OpsRangePreset>("last7");
  const [granularity, setGranularity] = useState<OpsGranularity>("daily");
  const [slicers, setSlicers] = useState<OpsSlicers>(EMPTY_OPS_SLICERS);

  const boundsQuery = usePerformanceOpsBounds();
  const today = boundsQuery.data?.today ?? todayFallback;
  const firstDelivery = boundsQuery.data?.first_delivery_date ?? null;
  const overCap = Boolean(boundsQuery.data?.over_cap);

  const range = useMemo(() => {
    try {
      return resolveOpsRange(preset, today, firstDelivery);
    } catch {
      return resolveOpsRange("last7", today, firstDelivery);
    }
  }, [preset, today, firstDelivery]);

  const rangeError = useMemo(() => {
    try {
      assertOpsRange(range.from, range.to);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "invalid_date_range";
    }
  }, [range]);

  const snapshotQuery = usePerformanceOpsSnapshot(
    {
      from: range.from,
      to: range.to,
      granularity,
      slicers,
      outsourceOnly: tab === "outsource",
    },
    Boolean(boundsQuery.data) && !rangeError,
  );

  const data = snapshotQuery.data;
  const isLoading = boundsQuery.isLoading || snapshotQuery.isLoading;
  const isError = boundsQuery.isError || snapshotQuery.isError;
  const errorMessage =
    snapshotQuery.error instanceof Error ? snapshotQuery.error.message : null;

  function exportTab() {
    if (!data) return;
    const riders = data.riders.map(enrichOpsRider);
    if (tab === "overview") {
      downloadCsv(
        "ops-overview",
        toCsv(
          ["metric", "value"],
          [
            ["orders", data.kpis.orders],
            ["overall_dpd", data.kpis.overall_dpd],
            ["avg_dpd_eff", data.kpis.avg_dpd_eff],
            ["avg_tgt_eff", data.kpis.avg_tgt_eff],
            ["active", data.kpis.active],
            ["riders", data.kpis.riders],
          ],
        ),
      );
      return;
    }
    downloadCsv(
      `ops-${tab}`,
      toCsv(
        ["name", "id", "store", "zone", "dpd", "tgt_eff", "dpd_eff", "orders"],
        riders.map((r) => [
          r.name,
          r.display_id,
          r.store_label,
          r.zone ?? "—",
          r.dpd,
          r.tgt_eff,
          r.dpd_eff,
          r.orders,
        ]),
      ),
    );
  }

  return (
    <AppPage>
      <AppPageHeader
        title={t("title")}
        description={t("ops.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => void snapshotQuery.refetch()}
              disabled={snapshotQuery.isFetching}
            >
              {snapshotQuery.isFetching ? t("refreshing") : t("refresh")}
            </button>
            <Link
              href="/performance/settings"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm text-primary transition-colors hover:bg-primary/10"
            >
              <Settings2 className="size-3.5" />
              {t("settingsLink")}
            </Link>
          </div>
        }
      />

      <TabBar
        items={[
          { id: "overview", label: t("ops.tabOverview") },
          { id: "dpd", label: t("ops.tabDpd") },
          { id: "riders", label: t("ops.tabRiders") },
          { id: "topbottom", label: t("ops.tabTopBottom") },
          { id: "outsource", label: t("ops.tabOutsource") },
        ]}
        activeId={tab}
        onSelect={(id) => setTab(id as PerformanceHubTab)}
        className="mb-2"
      />

      <div className={cn("flex flex-col", LAYOUT.stackGap)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <OpsRangePills
            preset={preset}
            allDisabled={overCap}
            onPreset={(next) => {
              if (next === "all" && overCap) return;
              setPreset(next);
            }}
          />
          <OpsGranularityPills value={granularity} onChange={setGranularity} />
        </div>
        {overCap && preset !== "all" ? (
          <p className="text-[10px] text-muted-foreground">{t("ops.allTimeCapped")}</p>
        ) : null}

        <OpsSlicerBar
          slicers={slicers}
          options={data?.options ?? { zones: [], restaurants: [], nationalities: [] }}
          hideSourceType={tab === "outsource"}
          onChange={setSlicers}
          onClear={() => setSlicers(EMPTY_OPS_SLICERS)}
          onExport={data ? exportTab : undefined}
          exportLabel={t("ops.exportTab")}
        />

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError || rangeError ? (
          <AppEmptyState
            title={t("ops.errorTitle")}
            description={
              rangeError === "range_too_large" || errorMessage === "range_too_large"
                ? t("ops.rangeTooLarge")
                : t("ops.errorHint")
            }
          />
        ) : !data ? (
          <AppEmptyState title={t("emptyTitle")} description={t("emptyHint")} />
        ) : tab === "overview" ? (
          <OpsOverviewTab data={data} />
        ) : tab === "dpd" ? (
          <OpsDpdTab data={data} />
        ) : tab === "riders" ? (
          <OpsRidersTab data={data} />
        ) : tab === "topbottom" ? (
          <OpsTopBottomTab data={data} />
        ) : (
          <OpsOutsourceTab data={data} />
        )}
      </div>
    </AppPage>
  );
}
