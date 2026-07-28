"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Package,
  Search,
  UserCheck,
  Users,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Badge } from "@/components/ui/badge";
import { MetricTile, type Tone } from "@/components/ui/metric-tile";
import type { DriverLiveLocation } from "@/features/locations/types";
import { SearchSelect } from "@/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LiveDriverList } from "./live-driver-list";
import { TrackingGlassCard } from "./tracking-shell";
import type { LiveTrackingFilterState } from "./live-tracking-filters";
import { TrackingTabSwitcher, type TrackingViewTab } from "./tracking-tab-switcher";

export function FleetOverviewPanel({
  totalDrivers,
  trackedCount,
  inProgressCount,
  alertsCount,
  drivers,
  selectedDriverId,
  onSelectDriver,
  filters,
  onChange,
  zoneOptions,
  partnerOptions,
  activeTab,
  onTabChange,
  avatarByDriverId,
  className,
}: {
  totalDrivers: number;
  trackedCount: number;
  inProgressCount: number;
  alertsCount: number;
  drivers: DriverLiveLocation[];
  selectedDriverId: string | null;
  onSelectDriver: (driverId: string | null) => void;
  filters: LiveTrackingFilterState;
  onChange: (next: LiveTrackingFilterState) => void;
  zoneOptions: Array<{ id: string; label: string }>;
  partnerOptions: Array<{ id: string; label: string }>;
  activeTab: TrackingViewTab;
  onTabChange: (tab: TrackingViewTab) => void;
  avatarByDriverId?: Map<string, string | null>;
  className?: string;
}) {
  const t = useTranslations("pages.liveTracking");

  const statusChips: Array<{
    id: LiveTrackingFilterState["statusChips"][number];
    label: string;
  }> = [
    { id: "online", label: t("chipOnline") },
    { id: "on_duty", label: t("chipOnDuty") },
    { id: "idle", label: t("chipIdle") },
    { id: "alert", label: t("chipAlert") },
    { id: "offline", label: t("chipOffline") },
  ];

  const selectedChipCount = filters.statusChips.length;

  const stats = useMemo(
    (): Array<{
      id: string;
      label: string;
      value: string;
      tone: Tone;
      icon: typeof Users;
    }> => [
      {
        id: "total",
        label: t("metricTotalDrivers"),
        value: totalDrivers.toLocaleString(),
        tone: "primary",
        icon: Users,
      },
      {
        id: "active",
        label: t("metricActiveTracked"),
        value: trackedCount.toLocaleString(),
        tone: "success",
        icon: UserCheck,
      },
      {
        id: "progress",
        label: t("metricInProgress"),
        value: inProgressCount.toLocaleString(),
        tone: "primary",
        icon: Package,
      },
      {
        id: "sos",
        label: t("metricGpsAlerts"),
        value: alertsCount.toLocaleString(),
        tone: "danger",
        icon: AlertTriangle,
      },
    ],
    [alertsCount, inProgressCount, t, totalDrivers, trackedCount],
  );

  const zoneSearchItems = useMemo(
    () =>
      zoneOptions.map((opt) => ({
        value: opt.id,
        label: opt.label,
        keywords: [opt.label, opt.id],
      })),
    [zoneOptions],
  );

  const partnerSearchItems = useMemo(
    () =>
      partnerOptions.map((opt) => ({
        value: opt.id,
        label: opt.label,
        keywords: [opt.label, opt.id],
      })),
    [partnerOptions],
  );

  return (
    <TrackingGlassCard
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col overflow-hidden border-slate-200 bg-white dark:border-slate-700/80 dark:bg-slate-900",
        className,
      )}
    >
      <div className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-700/80">
        <TrackingTabSwitcher value={activeTab} onChange={onTabChange} className="mb-2" />
        <div className="grid grid-cols-2 gap-2">
          {stats.map((tile) => (
            <MetricTile
              key={tile.id}
              label={tile.label}
              value={tile.value}
              tone={tile.tone}
              icon={tile.icon}
              trendPercent={undefined}
            />
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-3 px-3 py-3">
            <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder={t("searchPlaceholder")}
            className="h-9 rounded-lg border-slate-200 bg-slate-50 ps-8 text-sm shadow-none transition-colors focus-visible:bg-white dark:border-slate-700 dark:bg-slate-900"
          />
        </div>

        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-700/70 dark:bg-slate-900/60">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {t("filters")}
            </p>
            <button
              type="button"
              className="cursor-pointer text-xs font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400"
              onClick={() =>
                onChange({
                  ...filters,
                  statusChips: ["online", "on_duty", "idle", "alert", "offline"],
                  search: "",
                  zoneId: "all",
                  partnerId: "all",
                  trackingStatus: "all",
                  batteryLevel: "all",
                  gpsSignal: "all",
                })
              }
            >
              {t("reset")}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {statusChips.map((chip) => (
              <ToggleChip
                key={chip.id}
                size="md"
                selected={filters.statusChips.includes(chip.id)}
                onClick={() => {
                  const exists = filters.statusChips.includes(chip.id);
                  onChange({
                    ...filters,
                    statusChips: exists
                      ? filters.statusChips.filter((id) => id !== chip.id)
                      : [...filters.statusChips, chip.id],
                  });
                }}
              >
                {chip.label}
              </ToggleChip>
            ))}
            <span className="ms-auto inline-flex items-center text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {t("selectedCount", { count: selectedChipCount })}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <SearchSelect
            items={zoneSearchItems}
            value={filters.zoneId}
            onChange={(value) => onChange({ ...filters, zoneId: value ?? "all" })}
            placeholder={t("filterZone")}
            searchPlaceholder={t("filterZone")}
            defaultLimit={8}
            recentsKey="live-tracking-zone-filter"
            className="h-8 text-xs"
            clearable={false}
          />
          <SearchSelect
            items={partnerSearchItems}
            value={filters.partnerId}
            onChange={(value) => onChange({ ...filters, partnerId: value ?? "all" })}
            placeholder={t("filterPartner")}
            searchPlaceholder={t("filterPartner")}
            defaultLimit={8}
            recentsKey="live-tracking-partner-filter"
            className="h-8 text-xs"
            clearable={false}
          />
          <Select
            disabled
            items={[
              { value: "all", label: t("filterVehicleAll") },
              { value: "bike", label: t("filterVehicleBike") },
              { value: "car", label: t("filterVehicleCar") },
            ]}
            value="all"
            onValueChange={() => {}}
          >
            <SelectTrigger className="h-8 cursor-not-allowed rounded-lg text-xs opacity-80">
              <div className="flex w-full items-center justify-between gap-2">
                <span className="truncate">{t("filterVehicleType")}</span>
                <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px]">
                  {t("comingSoon")}
                </Badge>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" label={t("filterVehicleAll")}>
                {t("filterVehicleAll")}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            disabled
            items={[
              { value: "all", label: t("filterSpeedAll") },
              { value: "overspeed", label: t("filterSpeedOverspeed") },
              { value: "normal", label: t("filterSpeedNormal") },
            ]}
            value="all"
            onValueChange={() => {}}
          >
            <SelectTrigger className="h-8 cursor-not-allowed rounded-lg text-xs opacity-80">
              <div className="flex w-full items-center justify-between gap-2">
                <span className="truncate">{t("filterSpeedAlerts")}</span>
                <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px]">
                  {t("comingSoon")}
                </Badge>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" label={t("filterSpeedAll")}>
                {t("filterSpeedAll")}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            items={[
              { value: "all", label: t("filterBatteryAll") },
              { value: "low", label: t("filterBatteryLow") },
              { value: "medium", label: t("filterBatteryMedium") },
              { value: "high", label: t("filterBatteryHigh") },
            ]}
            value={filters.batteryLevel}
            onValueChange={(value) =>
              onChange({
                ...filters,
                batteryLevel: (value as LiveTrackingFilterState["batteryLevel"]) ?? "all",
              })
            }
          >
            <SelectTrigger className="h-8 cursor-pointer rounded-lg text-xs">
              <SelectValue placeholder={t("filterBattery")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" label={t("filterBatteryAll")}>
                {t("filterBatteryAll")}
              </SelectItem>
              <SelectItem value="low" label={t("filterBatteryLow")}>
                {t("filterBatteryLow")}
              </SelectItem>
              <SelectItem value="medium" label={t("filterBatteryMedium")}>
                {t("filterBatteryMedium")}
              </SelectItem>
              <SelectItem value="high" label={t("filterBatteryHigh")}>
                {t("filterBatteryHigh")}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            items={[
              { value: "all", label: t("filterGpsAll") },
              { value: "excellent", label: t("gpsExcellent") },
              { value: "good", label: t("gpsGood") },
              { value: "weak", label: t("gpsWeak") },
            ]}
            value={filters.gpsSignal}
            onValueChange={(value) =>
              onChange({ ...filters, gpsSignal: (value as LiveTrackingFilterState["gpsSignal"]) ?? "all" })
            }
          >
            <SelectTrigger className="h-8 cursor-pointer rounded-lg text-xs">
              <SelectValue placeholder={t("filterGps")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" label={t("filterGpsAll")}>
                {t("filterGpsAll")}
              </SelectItem>
              <SelectItem value="excellent" label={t("gpsExcellent")}>
                {t("gpsExcellent")}
              </SelectItem>
              <SelectItem value="good" label={t("gpsGood")}>
                {t("gpsGood")}
              </SelectItem>
              <SelectItem value="weak" label={t("gpsWeak")}>
                {t("gpsWeak")}
              </SelectItem>
            </SelectContent>
          </Select>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700/80">
            <div className="border-b border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700/70 dark:bg-slate-900/40 dark:text-slate-400">
              {t("trackedCount", { count: drivers.length })}
            </div>
            <LiveDriverList
              drivers={drivers}
              selectedId={selectedDriverId}
              onSelect={onSelectDriver}
              avatarByDriverId={avatarByDriverId}
            />
          </div>
        </div>
      </div>
    </TrackingGlassCard>
  );
}
