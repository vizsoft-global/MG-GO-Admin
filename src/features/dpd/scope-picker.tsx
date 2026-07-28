"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiCombobox } from "@/components/multi-combobox";
import {
  partnerSearchOptions,
  restaurantSearchOptions,
  zoneSearchOptions,
} from "@/lib/search-options";
import type { DpdScopeOptions, RuleScopeType } from "./types";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-[11px] text-destructive" role="alert">
      {message}
    </p>
  );
}

export function ScopePicker({
  scopeType,
  zoneIds,
  partnerIds,
  restaurantIds,
  onScopeTypeChange,
  onZoneIdsChange,
  onPartnerIdsChange,
  onRestaurantIdsChange,
  options,
  disabled,
  scopeError,
}: {
  scopeType: RuleScopeType;
  zoneIds: string[];
  partnerIds: string[];
  restaurantIds: string[];
  onScopeTypeChange: (v: RuleScopeType) => void;
  onZoneIdsChange: (v: string[]) => void;
  onPartnerIdsChange: (v: string[]) => void;
  onRestaurantIdsChange: (v: string[]) => void;
  options: DpdScopeOptions | undefined;
  disabled?: boolean;
  scopeError?: string;
}) {
  const t = useTranslations("pages.dpd");

  const zones = options?.zones ?? [];
  const partners = options?.partners ?? [];
  const restaurants = options?.restaurants ?? [];

  const scopeTypeItems = [
    { value: "zone", label: t("scope.zone") },
    { value: "partner", label: t("scope.partner") },
    { value: "restaurant", label: t("scope.restaurant") },
  ];

  const zoneItems = zoneSearchOptions(zones).map((item) => ({
    value: item.value,
    label: item.hint ? `${item.label} (${item.hint})` : item.label,
  }));
  const partnerItems = partnerSearchOptions(partners).map((item) => ({
    value: item.value,
    label: item.hint ? `${item.label} (${item.hint})` : item.label,
  }));
  const restaurantItems = restaurantSearchOptions(restaurants).map((item) => ({
    value: item.value,
    label: item.hint ? `${item.label} · ${item.hint}` : item.label,
  }));

  const selectedSummary = (count: number) =>
    t("multiSelect.selectedSummary", { count });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label>{t("fields.scopeType")}</Label>
        <Select
          items={scopeTypeItems}
          value={scopeType}
          onValueChange={(v) => {
            if (v) onScopeTypeChange(v as RuleScopeType);
          }}
          disabled={disabled}
        >
          <SelectTrigger className="h-9 w-full cursor-pointer rounded-lg bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zone" label={t("scope.zone")}>
              {t("scope.zone")}
            </SelectItem>
            <SelectItem value="partner" label={t("scope.partner")}>
              {t("scope.partner")}
            </SelectItem>
            <SelectItem value="restaurant" label={t("scope.restaurant")}>
              {t("scope.restaurant")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {scopeType === "zone" ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("fields.zone")}</Label>
          <MultiCombobox
            items={zoneItems}
            value={zoneIds}
            onChange={onZoneIdsChange}
            placeholder={t("placeholders.pickZones")}
            searchPlaceholder={t("multiSelect.search")}
            emptyText={t("multiSelect.empty")}
            selectAllLabel={t("multiSelect.selectAll")}
            clearLabel={t("multiSelect.clear")}
            selectedSummary={selectedSummary}
            disabled={disabled}
          />
          <FieldError message={scopeError} />
        </div>
      ) : null}

      {scopeType === "partner" ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("fields.partner")}</Label>
          <MultiCombobox
            items={partnerItems}
            value={partnerIds}
            onChange={onPartnerIdsChange}
            placeholder={t("placeholders.pickPartners")}
            searchPlaceholder={t("multiSelect.search")}
            emptyText={t("multiSelect.empty")}
            selectAllLabel={t("multiSelect.selectAll")}
            clearLabel={t("multiSelect.clear")}
            selectedSummary={selectedSummary}
            disabled={disabled}
          />
          <FieldError message={scopeError} />
        </div>
      ) : null}

      {scopeType === "restaurant" ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("fields.restaurant")}</Label>
          <MultiCombobox
            items={restaurantItems}
            value={restaurantIds}
            onChange={onRestaurantIdsChange}
            placeholder={t("placeholders.pickRestaurants")}
            searchPlaceholder={t("multiSelect.search")}
            emptyText={t("multiSelect.empty")}
            selectAllLabel={t("multiSelect.selectAll")}
            clearLabel={t("multiSelect.clear")}
            selectedSummary={selectedSummary}
            disabled={disabled}
          />
          <FieldError message={scopeError} />
        </div>
      ) : null}
    </div>
  );
}
