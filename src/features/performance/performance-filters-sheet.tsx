"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SearchSelect } from "@/components/ui/search-select";
import { useDpdScopeOptions } from "@/features/dpd/use-dpd";
import { partnerSearchOptions, zoneSearchOptions } from "@/lib/search-options";

export type PerformanceFiltersState = {
  partnerId: string;
  zoneId: string;
  restaurantId: string;
  driverStatus: string;
};

export const DEFAULT_PERFORMANCE_FILTERS: PerformanceFiltersState = {
  partnerId: "",
  zoneId: "",
  restaurantId: "",
  driverStatus: "all",
};

export function PerformanceFiltersSheet({
  open,
  onOpenChange,
  filters,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: PerformanceFiltersState;
  onApply: (next: PerformanceFiltersState) => void;
}) {
  const t = useTranslations("pages.performance");
  const [draft, setDraft] = useState(filters);
  const { data: scopeOptions } = useDpdScopeOptions();

  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const restaurants = scopeOptions?.restaurants ?? [];
  const partners = scopeOptions?.partners ?? [];
  const zones = scopeOptions?.zones ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("filtersTitle")}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-3">
          <div className="space-y-2">
            <Label>{t("filterPartner")}</Label>
            <SearchSelect
              value={draft.partnerId || null}
              onChange={(v) => setDraft((d) => ({ ...d, partnerId: v ?? "" }))}
              items={partnerSearchOptions(partners)}
              placeholder={t("filterPartnerAll")}
              recentsKey="performance-partner"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("filterZone")}</Label>
            <SearchSelect
              value={draft.zoneId || null}
              onChange={(v) => setDraft((d) => ({ ...d, zoneId: v ?? "" }))}
              items={zoneSearchOptions(zones)}
              placeholder={t("filterZoneAll")}
              recentsKey="performance-zone"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("filterRestaurant")}</Label>
            <SearchSelect
              value={draft.restaurantId || null}
              onChange={(v) =>
                setDraft((d) => ({ ...d, restaurantId: v ?? "" }))
              }
              items={restaurants.map((r) => ({ value: r.id, label: r.name }))}
              placeholder={t("filterRestaurantAll")}
              recentsKey="performance-restaurant"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("filterDriverStatus")}</Label>
            <Select
              value={draft.driverStatus}
              onValueChange={(v) =>
                v && setDraft((d) => ({ ...d, driverStatus: v }))
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filterStatusAll")}</SelectItem>
                <SelectItem value="active">{t("statusActive")}</SelectItem>
                <SelectItem value="inactive">{t("statusInactive")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </SheetBody>
        <SheetFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => {
              setDraft(DEFAULT_PERFORMANCE_FILTERS);
              onApply(DEFAULT_PERFORMANCE_FILTERS);
              onOpenChange(false);
            }}
          >
            {t("filtersReset")}
          </Button>
          <Button
            type="button"
            className="h-9"
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            {t("filtersApply")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function PerformanceFiltersButton({
  activeCount,
  onClick,
}: {
  activeCount: number;
  onClick: () => void;
}) {
  const t = useTranslations("pages.performance");
  return (
    <Button
      type="button"
      variant="outline"
      className="h-9 gap-1.5"
      onClick={onClick}
    >
      <SlidersHorizontal className="size-3.5" />
      {t("filters")}
      {activeCount > 0 ? (
        <span className="rounded-md bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
          {activeCount}
        </span>
      ) : null}
    </Button>
  );
}
