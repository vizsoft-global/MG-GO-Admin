"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bike, Building2, CalendarRange, Check, CircleAlert, CircleCheck, CircleDashed, CircleMinus, Flag, Globe2, MapPin, Store, Users } from "lucide-react";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  PAYROLL_ZONE_CATEGORY_CHIP,
  PAYROLL_ZONE_CATEGORY_FILTERS,
  countRidersByZoneCategory,
  monthMeta,
  payrollMonths,
  type PayrollRangePreset,
  type PayrollZoneCategoryFilter,
} from "./payroll-formulas";
import type { PayrollOptions, PayrollSlicers } from "./payroll-types";

const VEHICLE_KEYS = ["bike", "car"] as const;
const SOURCE_TYPES = ["in_house", "outsourced"] as const;

/**
 * SOP §5.1 asks for "Partner-view buttons with rider counts" rather than another
 * Partner slicer: the client *is* the partner, so the buttons are the fastest way
 * to switch which rule set the grid is showing.
 */
export function PayrollPartnerView({
  riders,
  value,
  onChange,
}: {
  riders: ReadonlyArray<{ projectKey: string | null }>;
  value: readonly string[];
  onChange: (projectKeys: string[]) => void;
}) {
  const t = useTranslations("pages.payroll.partner");
  const counts = new Map<string, number>();
  for (const rider of riders) {
    if (!rider.projectKey) continue;
    counts.set(rider.projectKey, (counts.get(rider.projectKey) ?? 0) + 1);
  }
  const allSelected = value.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-pressed={allSelected}
        onClick={() => onChange([])}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[11px] font-semibold transition-colors",
          allSelected
            ? "border-emerald-500 bg-emerald-100 text-emerald-900 shadow-sm ring-1 ring-emerald-400/50"
            : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        <Building2 className="size-3.5" />
        {t("all")}
        <span className="tabular-nums opacity-70">{riders.length}</span>
      </button>
      {DRIVER_PROJECT_KEYS.map((key) => {
        const selected = value.includes(key);
        const count = counts.get(key) ?? 0;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? value.filter((k) => k !== key) : [...value, key])}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[11px] font-semibold transition-colors",
              selected
                ? "border-emerald-500 bg-emerald-100 text-emerald-900 shadow-sm ring-1 ring-emerald-400/50"
                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {selected ? <Check className="size-3.5" /> : <Building2 className="size-3.5 opacity-60" />}
            {partnerLabel(key)}
            <span className="tabular-nums opacity-70">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Zone category from the previous completed month (SOP §5.1). This is what the
 * client rules read as `zone_category`, so filtering by it shows exactly which
 * riders a band is paying.
 */
export function PayrollZoneCategoryChips({
  riders,
  value,
  onChange,
}: {
  riders: ReadonlyArray<{ zoneCategory: string }>;
  value: PayrollZoneCategoryFilter | null;
  onChange: (next: PayrollZoneCategoryFilter | null) => void;
}) {
  const t = useTranslations("pages.payroll.zoneCategory");
  const counts = useMemo(() => countRidersByZoneCategory(riders), [riders]);
  const icons = {
    good: CircleCheck,
    average: CircleMinus,
    low: CircleAlert,
    not_set: CircleDashed,
  } as const;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PAYROLL_ZONE_CATEGORY_FILTERS.map((category) => {
        const Icon = icons[category];
        const selected = value === category;
        return (
          <ToggleChip
            key={category}
            selected={selected}
            icon={Icon}
            onClick={() => onChange(selected ? null : category)}
            leading={
              <span
                className="size-3.5 rounded-sm"
                style={{ background: PAYROLL_ZONE_CATEGORY_CHIP[category] }}
              />
            }
          >
            {t(category)}
            <span className="tabular-nums opacity-70"> · {counts[category]}</span>
          </ToggleChip>
        );
      })}
    </div>
  );
}

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
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const fallback = allowedKeys[allowedKeys.length - 1] ?? today.slice(0, 7);
  const [draft, setDraft] = useState(appliedKey ?? fallback);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(appliedKey ?? fallback);
    setErr(null);
  }, [open, appliedKey, fallback]);

  const appliedMeta = appliedKey ? monthMeta(appliedKey, locale) : null;
  const label = selected && appliedMeta ? appliedMeta.label : t("custom");
  const monthItems = allowedKeys.map((key) => ({
    value: key,
    label: monthMeta(key, locale)?.label ?? key,
  }));

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
          <Select
            value={draft}
            onValueChange={(value) => setDraft(String(value ?? fallback))}
            items={monthItems}
          >
            <SelectTrigger className="mt-1 h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
