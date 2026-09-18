"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Bike,
  Building2,
  CalendarRange,
  Download,
  FilterX,
  Flag,
  Globe2,
  MapPin,
  Store,
  Users,
} from "lucide-react";
import { ToggleChip } from "@/components/app/toggle-chip";
import { LAYOUT } from "@/components/app/layout-spacing";
import { countryLabel } from "@/lib/geo/countries";
import { DRIVER_PROJECT_KEYS } from "@/features/fleet/fleet-labels";
import {
  OPS_GRANULARITIES,
  OPS_RANGE_PRESETS,
  OPS_VIEW_BY,
  SOURCE_COMPANY_KEYS,
  SOURCE_COMPANY_LABEL,
  isChartableDimKey,
  storesVisibleForPartners,
  type OpsChartMetric,
  type OpsGranularity,
  type OpsRangePreset,
} from "../performance-ops-formulas";
import type { OpsOptions, OpsSlicers, PerformanceHubTab } from "../performance-ops-types";
import { partnerLabel, vehicleLabel } from "../performance-ops-format";
import { OpsCustomRangePopover } from "./ops-custom-range";
import { OpsMultiSelect } from "./ops-multi-select";
import { cn } from "@/lib/utils";

const VEHICLE_KEYS = ["bike", "car"] as const;
const SOURCE_TYPES = ["in_house", "outsourced"] as const;

export function OpsRangePills({
  preset,
  onPreset,
  allDisabled,
  today,
  customFrom,
  customTo,
  onApplyCustom,
}: {
  preset: OpsRangePreset;
  onPreset: (next: OpsRangePreset) => void;
  allDisabled?: boolean;
  today: string;
  customFrom: string | null;
  customTo: string | null;
  onApplyCustom: (from: string, to: string) => void;
}) {
  const t = useTranslations("pages.performance.ops");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {OPS_RANGE_PRESETS.filter((id) => id !== "custom").map((id) => (
        <ToggleChip
          key={id}
          selected={preset === id}
          disabled={id === "all" && allDisabled}
          icon={CalendarRange}
          onClick={() => onPreset(id)}
        >
          {t(`range.${id}`)}
        </ToggleChip>
      ))}
      <OpsCustomRangePopover
        selected={preset === "custom"}
        today={today}
        appliedFrom={customFrom}
        appliedTo={customTo}
        onApply={onApplyCustom}
      />
    </div>
  );
}

export function OpsViewByPills({
  tab,
  value,
  onChange,
}: {
  tab: PerformanceHubTab;
  value: OpsChartMetric;
  onChange: (next: OpsChartMetric) => void;
}) {
  const t = useTranslations("pages.performance.ops");
  const options = OPS_VIEW_BY[tab];
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("viewBy.label")}
      </span>
      {options.map((id) => (
        <ToggleChip key={id} selected={value === id} onClick={() => onChange(id)}>
          {t(`viewBy.${id}`)}
        </ToggleChip>
      ))}
    </div>
  );
}

export function OpsGranularityPills({
  value,
  onChange,
}: {
  value: OpsGranularity;
  onChange: (next: OpsGranularity) => void;
}) {
  const t = useTranslations("pages.performance.ops");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {OPS_GRANULARITIES.map((id) => (
        <ToggleChip
          key={id}
          selected={value === id}
          onClick={() => onChange(id)}
        >
          {t(`granularity.${id}`)}
        </ToggleChip>
      ))}
    </div>
  );
}

export function OpsSlicerBar({
  slicers,
  onChange,
  options,
  hideSourceType,
  onClear,
  onExport,
  exportLabel,
}: {
  slicers: OpsSlicers;
  onChange: (next: OpsSlicers) => void;
  options: OpsOptions;
  hideSourceType?: boolean;
  onClear: () => void;
  onExport?: () => void;
  exportLabel?: string;
}) {
  const t = useTranslations("pages.performance.ops");
  const showStores = storesVisibleForPartners(slicers.projectKeys);

  const zoneOpts = useMemo(
    () => options.zones.map((z) => ({ value: z.id, label: z.name })),
    [options.zones],
  );
  const storeOpts = useMemo(
    () => options.restaurants.map((r) => ({ value: r.id, label: r.name })),
    [options.restaurants],
  );
  const natOpts = useMemo(
    () =>
      options.nationalities
        .filter((code) => isChartableDimKey(code))
        .map((code) => ({
          value: code,
          label: countryLabel(code),
          keywords: [code],
        })),
    [options.nationalities],
  );

  function patch(partial: Partial<OpsSlicers>) {
    const next = { ...slicers, ...partial };
    if (!storesVisibleForPartners(next.projectKeys)) {
      next.restaurantIds = [];
    }
    onChange(next);
  }

  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 shadow-sm", LAYOUT.stackGap)}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <OpsMultiSelect
          label={t("slicer.partner")}
          icon={OPS_SLICER_ICONS.partner}
          allLabel={t("slicer.allPartners")}
          countNoun={t("slicer.nounPartners")}
          searchPlaceholder={t("slicer.searchPartner")}
          value={slicers.projectKeys}
          onChange={(projectKeys) => patch({ projectKeys })}
          options={DRIVER_PROJECT_KEYS.map((k) => ({
            value: k,
            label: partnerLabel(k),
          }))}
        />
        <OpsMultiSelect
          label={t("slicer.zone")}
          icon={OPS_SLICER_ICONS.zone}
          allLabel={t("slicer.allZones")}
          countNoun={t("slicer.nounZones")}
          searchPlaceholder={t("slicer.searchZone")}
          value={slicers.zoneIds}
          onChange={(zoneIds) => patch({ zoneIds })}
          options={zoneOpts}
        />
        <OpsMultiSelect
          label={t("slicer.vehicle")}
          icon={OPS_SLICER_ICONS.vehicle}
          allLabel={t("slicer.allVehicles")}
          countNoun={t("slicer.nounVehicles")}
          searchPlaceholder={t("slicer.searchVehicle")}
          value={slicers.vehicleKeys}
          onChange={(vehicleKeys) => patch({ vehicleKeys })}
          options={VEHICLE_KEYS.map((k) => ({
            value: k,
            label: vehicleLabel(k),
          }))}
        />
        <OpsMultiSelect
          label={t("slicer.nationality")}
          icon={OPS_SLICER_ICONS.nationality}
          allLabel={t("slicer.allNationalities")}
          countNoun={t("slicer.nounNationalities")}
          searchPlaceholder={t("slicer.searchNationality")}
          value={slicers.nationalities}
          onChange={(nationalities) => patch({ nationalities })}
          options={natOpts}
        />
        {hideSourceType ? null : (
          <OpsMultiSelect
            label={t("slicer.sourceType")}
            icon={OPS_SLICER_ICONS.sourceType}
          allLabel={t("slicer.allSourceTypes")}
          countNoun={t("slicer.nounSourceTypes")}
          searchPlaceholder={t("slicer.searchSourceType")}
            value={slicers.sourceTypes}
            onChange={(sourceTypes) => patch({ sourceTypes })}
            options={SOURCE_TYPES.map((k) => ({
              value: k,
              label: t(`sourceType.${k}`),
            }))}
          />
        )}
        <OpsMultiSelect
          label={t("slicer.company")}
          icon={OPS_SLICER_ICONS.company}
          allLabel={t("slicer.allCompanies")}
          countNoun={t("slicer.nounCompanies")}
          searchPlaceholder={t("slicer.searchCompany")}
          value={slicers.sourceCompanies}
          onChange={(sourceCompanies) => patch({ sourceCompanies })}
          options={SOURCE_COMPANY_KEYS.map((k) => ({
            value: k,
            label: SOURCE_COMPANY_LABEL[k],
          }))}
        />
        <OpsMultiSelect
          label={t("slicer.store")}
          icon={OPS_SLICER_ICONS.store}
          allLabel={t("slicer.allStores")}
          countNoun={t("slicer.nounStores")}
          searchPlaceholder={t("slicer.searchStore")}
          emptyLabel={showStores ? undefined : t("slicer.noStores")}
          disabled={!showStores}
          value={showStores ? slicers.restaurantIds : []}
          onChange={(restaurantIds) => patch({ restaurantIds })}
          options={showStores ? storeOpts : []}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted/40"
        >
          <FilterX className="size-3.5" />
          {t("clearFilters")}
        </button>
        {onExport ? (
          <button
            type="button"
            onClick={onExport}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs text-primary hover:bg-primary/10"
          >
            <Download className="size-3.5" />
            {exportLabel ?? t("exportTab")}
          </button>
        ) : null}
        <span className="ms-auto hidden text-[10px] text-muted-foreground lg:inline">
          {t("slicerHint")}
        </span>
      </div>
    </div>
  );
}

export const OPS_SLICER_ICONS = {
  partner: Building2,
  zone: MapPin,
  vehicle: Bike,
  nationality: Globe2,
  sourceType: Users,
  company: Flag,
  store: Store,
};
