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

export type AttendanceFiltersState = {
  partnerId: string;
  zoneId: string;
  restaurantId: string;
  status: string;
};

export const DEFAULT_ATTENDANCE_FILTERS: AttendanceFiltersState = {
  partnerId: "",
  zoneId: "",
  restaurantId: "",
  status: "all",
};

export function AttendanceFiltersSheet({
  open,
  onOpenChange,
  filters,
  onApply,
  showStatus = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: AttendanceFiltersState;
  onApply: (next: AttendanceFiltersState) => void;
  showStatus?: boolean;
}) {
  const t = useTranslations("pages.attendance");
  const [draft, setDraft] = useState(filters);
  const { data: scopeOptions } = useDpdScopeOptions();

  useEffect(() => {
    if (open) setDraft(filters);
  }, [open, filters]);

  const restaurants = scopeOptions?.restaurants ?? [];
  const partners = scopeOptions?.partners ?? [];
  const zones = scopeOptions?.zones ?? [];

  const restaurantItems = restaurants.map((r) => ({
    value: r.id,
    label: r.name,
  }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("filtersTitle")}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="space-y-2">
            <Label>{t("filterPartner")}</Label>
            <SearchSelect
              value={draft.partnerId || null}
              onChange={(v) => setDraft((d) => ({ ...d, partnerId: v ?? "" }))}
              items={partnerSearchOptions(partners)}
              placeholder={t("filterPartnerAll")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("filterZone")}</Label>
            <SearchSelect
              value={draft.zoneId || null}
              onChange={(v) => setDraft((d) => ({ ...d, zoneId: v ?? "" }))}
              items={zoneSearchOptions(zones)}
              placeholder={t("filterZoneAll")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("filterRestaurant")}</Label>
            <SearchSelect
              value={draft.restaurantId || null}
              onChange={(v) => setDraft((d) => ({ ...d, restaurantId: v ?? "" }))}
              items={restaurantItems}
              placeholder={t("filterRestaurantAll")}
            />
          </div>
          {showStatus ? (
            <div className="space-y-2">
              <Label>{t("colStatus")}</Label>
              <Select
                value={draft.status}
                onValueChange={(v) => v && setDraft((d) => ({ ...d, status: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("filterStatusAll")}</SelectItem>
                  <SelectItem value="late">{t("liveLate")}</SelectItem>
                  <SelectItem value="absent">{t("liveAbsent")}</SelectItem>
                  <SelectItem value="on_duty">{t("liveOnDuty")}</SelectItem>
                  <SelectItem value="offline_during_shift">{t("liveOffline")}</SelectItem>
                  <SelectItem value="problems">{t("kpiProblems")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </SheetBody>
        <SheetFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onApply(DEFAULT_ATTENDANCE_FILTERS);
              onOpenChange(false);
            }}
          >
            {t("clearFilters")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            {t("applyFilters")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function AttendanceFiltersButton({
  activeCount,
  onClick,
}: {
  activeCount: number;
  onClick: () => void;
}) {
  const t = useTranslations("pages.attendance");
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <SlidersHorizontal className="h-4 w-4" />
      {t("filters")}
      {activeCount > 0 ? (
        <span className="ms-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
          {activeCount}
        </span>
      ) : null}
    </Button>
  );
}
