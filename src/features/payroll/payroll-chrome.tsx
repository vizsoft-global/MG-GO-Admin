"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Bike, Building2, CalendarRange, Flag, Globe2, MapPin, Store, Users } from "lucide-react";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { countryLabel } from "@/lib/geo/countries";
import { DRIVER_PROJECT_KEYS } from "@/features/fleet/fleet-labels";
import { partnerLabel, vehicleLabel } from "@/features/performance/performance-ops-format";
import { SOURCE_COMPANY_KEYS, SOURCE_COMPANY_LABEL, storesVisibleForPartners } from "@/features/performance/performance-ops-formulas";
import { OpsMultiSelect } from "@/features/performance/ops/ops-multi-select";
import { cn } from "@/lib/utils";
import {
  PAYROLL_RANGE_PRESETS,
  monthMeta,
  payrollMonths,
  type PayrollRangePreset,
} from "./payroll-formulas";
import type { PayrollOptions, PayrollSlicers } from "./payroll-types";

const VEHICLE_KEYS = ["bike", "car"] as const;
const SOURCE_TYPES = ["in_house", "outsourced"] as const;

export function PayrollRangePills({
  today,
  preset,
  customKey,
  onPreset,
  onApplyCustom,
}: {
  today: string;
  preset: PayrollRangePreset;
  customKey: string | null;
  onPreset: (next: Exclude<PayrollRangePreset, "custom">) => void;
  onApplyCustom: (monthKey: string) => void;
}) {
  const t = useTranslations("pages.payroll.range");
  const allowed = useMemo(() => payrollMonths(today), [today]);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PAYROLL_RANGE_PRESETS.filter((id) => id !== "custom").map((id) => (
        <ToggleChip
          key={id}
          selected={preset === id}
          icon={CalendarRange}
          onClick={() => onPreset(id)}
        >
          {t(id)}
        </ToggleChip>
      ))}
      <PayrollCustomMonthPopover
        selected={preset === "custom"}
        today={today}
        allowedKeys={allowed.map((m) => m.key)}
        appliedKey={customKey}
        onApply={onApplyCustom}
      />
    </div>
  );
}

function PayrollCustomMonthPopover({
  selected,
  today,
  allowedKeys,
  appliedKey,
  onApply,
}: {
  selected: boolean;
  today: string;
  allowedKeys: string[];
  appliedKey: string | null;
  onApply: (monthKey: string) => void;
}) {
  const t = useTranslations("pages.payroll.range");
  const [open, setOpen] = useState(false);
  const fallback = allowedKeys[allowedKeys.length - 1] ?? today.slice(0, 7);
  const [draft, setDraft] = useState(appliedKey ?? fallback);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(appliedKey ?? fallback);
    setErr(null);
  }, [open, appliedKey, fallback]);

  const appliedMeta = appliedKey ? monthMeta(appliedKey) : null;
  const label = selected && appliedMeta ? appliedMeta.label : t("custom");
  const minKey = allowedKeys[allowedKeys.length - 1] ?? fallback;
  const maxKey = allowedKeys[0] ?? fallback;

  function apply() {
    if (!allowedKeys.includes(draft)) {
      setErr(t("customErr"));
      return;
    }
    setErr(null);
    onApply(draft);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setErr(null);
      }}
    >
      <PopoverTrigger
        className={cn(
          "inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors",
          selected
            ? "border-emerald-500 bg-emerald-100 text-emerald-900 shadow-sm ring-1 ring-emerald-400/50"
            : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        <CalendarRange className={cn("h-3 w-3 shrink-0", selected ? "text-emerald-900" : "opacity-50")} />
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(280px,92vw)] origin-(--transform-origin) p-3">
        <p className="mb-2 text-xs font-semibold">{t("customTitle")}</p>
        <label className="min-w-0 text-[10px] font-medium text-muted-foreground">
          {t("customMonth")}
          <Input
            type="month"
            value={draft}
            min={minKey}
            max={maxKey}
            onChange={(e) => setDraft(e.target.value)}
            className="mt-1 h-9"
            openPickerOnFocus={false}
          />
        </label>
        {err ? <p className="mt-2 text-[11px] text-destructive">{err}</p> : null}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-xs"
            onClick={() => setOpen(false)}
          >
            {t("customCancel")}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground"
            onClick={apply}
          >
            {t("customApply")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
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
