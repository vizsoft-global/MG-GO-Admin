"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { partnerSearchOptions, zoneSearchOptions } from "@/lib/search-options";
import {
  DRIVER_ACCOUNT_STATUSES,
  type DriverAccountStatus,
} from "./types";
import type { DriverFormOptions } from "./use-driver-form-options";

export type DriversFiltersState = {
  zoneId: string;
  partnerId: string;
  status: "all" | DriverAccountStatus;
  restaurantId: string;
};

export const DEFAULT_DRIVERS_FILTERS: DriversFiltersState = {
  zoneId: "",
  partnerId: "",
  status: "all",
  restaurantId: "",
};

type FilterCategory = "zone" | "partner" | "status" | "restaurant";

const FILTER_CATEGORIES: FilterCategory[] = ["zone", "partner", "status", "restaurant"];

export function countActiveDriversFilters(filters: DriversFiltersState): number {
  let count = 0;
  if (filters.zoneId) count += 1;
  if (filters.partnerId) count += 1;
  if (filters.status !== "all") count += 1;
  if (filters.restaurantId) count += 1;
  return count;
}

function isCategoryActive(category: FilterCategory, filters: DriversFiltersState): boolean {
  switch (category) {
    case "zone":
      return Boolean(filters.zoneId);
    case "partner":
      return Boolean(filters.partnerId);
    case "status":
      return filters.status !== "all";
    case "restaurant":
      return Boolean(filters.restaurantId);
  }
}

export function DriversFiltersButton({
  activeCount,
  onClick,
}: {
  activeCount: number;
  onClick: () => void;
}) {
  const t = useTranslations("pages.drivers");
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="relative h-9 w-9 shrink-0 cursor-pointer rounded-lg"
      onClick={onClick}
      aria-label={t("filtersTitle")}
    >
      <SlidersHorizontal className="h-4 w-4" />
      {activeCount > 0 ? (
        <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
          {activeCount}
        </span>
      ) : null}
    </Button>
  );
}

export function DriversFiltersDialog({
  open,
  onOpenChange,
  filters,
  onApply,
  formOptions,
  getPreviewCount,
  baselineTotal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: DriversFiltersState;
  onApply: (next: DriversFiltersState) => void;
  formOptions?: DriverFormOptions;
  getPreviewCount: (next: DriversFiltersState) => number;
  baselineTotal: number;
}) {
  const t = useTranslations("pages.drivers");
  const [draft, setDraft] = useState(filters);
  const [activeCategory, setActiveCategory] = useState<FilterCategory>("zone");

  useEffect(() => {
    if (open) {
      setDraft(filters);
      setActiveCategory(
        !filters.zoneId
          ? "zone"
          : !filters.partnerId
            ? "partner"
            : filters.status === "all"
              ? "status"
              : !filters.restaurantId
                ? "restaurant"
                : "zone",
      );
    }
  }, [open, filters]);

  const zoneItems = useMemo(
    () => zoneSearchOptions(formOptions?.zones ?? []),
    [formOptions?.zones],
  );
  const partnerItems = useMemo(
    () => partnerSearchOptions(formOptions?.partners ?? []),
    [formOptions?.partners],
  );
  const restaurantItems = useMemo(
    () =>
      (formOptions?.restaurants ?? []).map((r) => ({
        value: r.id,
        label: r.name,
        keywords: [r.name, r.partner_name ?? ""].filter(Boolean),
      })),
    [formOptions?.restaurants],
  );

  const categoryLabel = (category: FilterCategory) => {
    switch (category) {
      case "zone":
        return t("filterZone");
      case "partner":
        return t("filterPartner");
      case "status":
        return t("filterStatus");
      case "restaurant":
        return t("filterRestaurant");
    }
  };

  const categoryValueLabel = (category: FilterCategory) => {
    switch (category) {
      case "zone":
        return (
          zoneItems.find((i) => i.value === draft.zoneId)?.label ?? draft.zoneId
        );
      case "partner":
        return (
          partnerItems.find((i) => i.value === draft.partnerId)?.label ??
          draft.partnerId
        );
      case "status":
        return draft.status === "all"
          ? t("filterStatusAll")
          : accountStatusLabel(draft.status, t);
      case "restaurant":
        return (
          restaurantItems.find((i) => i.value === draft.restaurantId)?.label ??
          draft.restaurantId
        );
    }
  };

  const unsetCategories = FILTER_CATEGORIES.filter(
    (c) => !isCategoryActive(c, draft),
  );

  const clearCategory = (category: FilterCategory) => {
    switch (category) {
      case "zone":
        setDraft((d) => ({ ...d, zoneId: "" }));
        break;
      case "partner":
        setDraft((d) => ({ ...d, partnerId: "" }));
        break;
      case "status":
        setDraft((d) => ({ ...d, status: "all" }));
        break;
      case "restaurant":
        setDraft((d) => ({ ...d, restaurantId: "" }));
        break;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[min(720px,96vw)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle>{t("filtersTitle")}</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-[320px] grid-cols-1 sm:grid-cols-[200px_1fr]">
          <div className="space-y-1 border-b border-border p-3 sm:border-b-0 sm:border-e">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {t("filtersCategories")}
            </p>
            {FILTER_CATEGORIES.map((category) => {
              const active = isCategoryActive(category, draft);
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={cn(
                    "flex w-full cursor-pointer flex-col rounded-lg px-3 py-2 text-start text-sm transition-colors",
                    activeCategory === category
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted/60",
                  )}
                >
                  <span className="font-medium">{categoryLabel(category)}</span>
                  {active ? (
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <span className="truncate">{categoryValueLabel(category)}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearCategory(category);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            clearCategory(category);
                          }
                        }}
                        aria-label={t("clearFilters")}
                      >
                        <X className="h-3 w-3" />
                      </span>
                    </span>
                  ) : null}
                </button>
              );
            })}
            {unsetCategories.length > 0 ? (
              <div className="pt-2">
                <p className="mb-1 text-xs text-muted-foreground">{t("filtersAddHint")}</p>
                {unsetCategories.map((category) => (
                  <button
                    key={`add-${category}`}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-primary hover:bg-muted/60"
                    onClick={() => setActiveCategory(category)}
                  >
                    <Plus className="h-3 w-3" />
                    {t("filtersAddCategory", { category: categoryLabel(category) })}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-3 p-4">
            <Label>{categoryLabel(activeCategory)}</Label>
            {activeCategory === "zone" ? (
              <SearchSelect
                items={zoneItems}
                value={draft.zoneId || null}
                onChange={(v) => setDraft((d) => ({ ...d, zoneId: v ?? "" }))}
                placeholder={t("filterZoneAll")}
                searchPlaceholder={t("filterZone")}
                defaultLimit={8}
                recentsKey="drivers-filter-zone"
                className="w-full"
              />
            ) : null}
            {activeCategory === "partner" ? (
              <SearchSelect
                items={partnerItems}
                value={draft.partnerId || null}
                onChange={(v) => setDraft((d) => ({ ...d, partnerId: v ?? "" }))}
                placeholder={t("filterPartnerAll")}
                searchPlaceholder={t("filterPartner")}
                defaultLimit={8}
                recentsKey="drivers-filter-partner"
                className="w-full"
              />
            ) : null}
            {activeCategory === "restaurant" ? (
              <SearchSelect
                items={restaurantItems}
                value={draft.restaurantId || null}
                onChange={(v) => setDraft((d) => ({ ...d, restaurantId: v ?? "" }))}
                placeholder={t("filterRestaurantAll")}
                searchPlaceholder={t("filterRestaurant")}
                defaultLimit={8}
                recentsKey="drivers-filter-restaurant"
                className="w-full"
              />
            ) : null}
            {activeCategory === "status" ? (
              <div className="space-y-1">
                {(["all", ...DRIVER_ACCOUNT_STATUSES] as const).map((status) => (
                  <label
                    key={status}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/60"
                  >
                    <input
                      type="radio"
                      name="driver-status-filter"
                      checked={draft.status === status}
                      onChange={() => setDraft((d) => ({ ...d, status }))}
                      className="cursor-pointer"
                    />
                    <span className="text-sm">
                      {status === "all"
                        ? t("filterStatusAll")
                        : accountStatusLabel(status, t)}
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-border px-4 py-3 sm:justify-between">
          <p className="text-xs tabular-nums text-muted-foreground">
            {t("filtersPreview", {
              visible: getPreviewCount(draft),
              total: baselineTotal,
            })}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9 cursor-pointer"
              onClick={() => {
                onApply({ ...DEFAULT_DRIVERS_FILTERS });
                onOpenChange(false);
              }}
            >
              {t("clearFilters")}
            </Button>
            <Button
              type="button"
              className="h-9 cursor-pointer"
              onClick={() => {
                onApply(draft);
                onOpenChange(false);
              }}
            >
              {t("applyFilters")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function accountStatusLabel(
  status: DriverAccountStatus,
  t: ReturnType<typeof useTranslations<"pages.drivers">>,
) {
  switch (status) {
    case "active":
      return t("statusActive");
    case "suspended":
      return t("statusSuspended");
    case "pending":
      return t("statusPendingAccount");
    default:
      return status;
  }
}
