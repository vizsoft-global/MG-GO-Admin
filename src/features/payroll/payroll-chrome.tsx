"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Bike, Building2, CalendarRange, Flag, Globe2, MapPin, Store, Users } from "lucide-react";
import { ToggleChip } from "@/components/app/toggle-chip";
import { countryLabel } from "@/lib/geo/countries";
import { DRIVER_PROJECT_KEYS } from "@/features/fleet/fleet-labels";
import { partnerLabel, vehicleLabel } from "@/features/performance/performance-ops-format";
import { SOURCE_COMPANY_KEYS, SOURCE_COMPANY_LABEL, storesVisibleForPartners } from "@/features/performance/performance-ops-formulas";
import { OpsMultiSelect } from "@/features/performance/ops/ops-multi-select";
import type { PayrollMonthMeta } from "./payroll-formulas";
import type { PayrollOptions, PayrollSlicers } from "./payroll-types";

const VEHICLE_KEYS = ["bike", "car"] as const;
const SOURCE_TYPES = ["in_house", "outsourced"] as const;

export function PayrollMonthButtons({
  months,
  value,
  onChange,
}: {
  months: PayrollMonthMeta[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {months.map((m) => (
        <ToggleChip
          key={m.key}
          selected={value === m.key}
          icon={CalendarRange}
          onClick={() => onChange(m.key)}
        >
          {m.label}
        </ToggleChip>
      ))}
    </div>
  );
}

export function PayrollSlicerBar({
  slicers,
  onChange,
  options,
}: {
  slicers: PayrollSlicers;
  onChange: (next: PayrollSlicers) => void;
  options: PayrollOptions;
}) {
  const t = useTranslations("pages.payroll");
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
      options.nationalities.map((code) => ({
        value: code,
        label: countryLabel(code),
        keywords: [code],
      })),
    [options.nationalities],
  );

  function patch(partial: Partial<PayrollSlicers>) {
    const next = { ...slicers, ...partial };
    if (!storesVisibleForPartners(next.projectKeys)) next.restaurantIds = [];
    onChange(next);
  }

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
      <OpsMultiSelect
        label={t("slicer.partner")}
        icon={Building2}
        allLabel={t("slicer.allPartners")}
        countNoun={t("slicer.nounPartners")}
        searchPlaceholder={t("slicer.searchPartner")}
        value={slicers.projectKeys}
        onChange={(projectKeys) => patch({ projectKeys })}
        options={DRIVER_PROJECT_KEYS.map((k) => ({ value: k, label: partnerLabel(k) }))}
      />
      <OpsMultiSelect
        label={t("slicer.zone")}
        icon={MapPin}
        allLabel={t("slicer.allZones")}
        countNoun={t("slicer.nounZones")}
        searchPlaceholder={t("slicer.searchZone")}
        value={slicers.zoneIds}
        onChange={(zoneIds) => patch({ zoneIds })}
        options={zoneOpts}
      />
      <OpsMultiSelect
        label={t("slicer.vehicle")}
        icon={Bike}
        allLabel={t("slicer.allVehicles")}
        countNoun={t("slicer.nounVehicles")}
        searchPlaceholder={t("slicer.searchVehicle")}
        value={slicers.vehicleKeys}
        onChange={(vehicleKeys) => patch({ vehicleKeys })}
        options={VEHICLE_KEYS.map((k) => ({ value: k, label: vehicleLabel(k) }))}
      />
      <OpsMultiSelect
        label={t("slicer.nationality")}
        icon={Globe2}
        allLabel={t("slicer.allNationalities")}
        countNoun={t("slicer.nounNationalities")}
        searchPlaceholder={t("slicer.searchNationality")}
        value={slicers.nationalities}
        onChange={(nationalities) => patch({ nationalities })}
        options={natOpts}
      />
      <OpsMultiSelect
        label={t("slicer.sourceType")}
        icon={Users}
        allLabel={t("slicer.allSourceTypes")}
        countNoun={t("slicer.nounSourceTypes")}
        searchPlaceholder={t("slicer.searchSourceType")}
        value={slicers.sourceTypes}
        onChange={(sourceTypes) => patch({ sourceTypes })}
        options={SOURCE_TYPES.map((k) => ({ value: k, label: t(`sourceType.${k}`) }))}
      />
      <OpsMultiSelect
        label={t("slicer.company")}
        icon={Flag}
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
        icon={Store}
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
  );
}
