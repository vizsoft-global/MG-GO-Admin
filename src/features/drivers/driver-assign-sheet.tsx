"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Info, Loader2, MapPin, Plus, Search, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { AttendancePill } from "./driver-list-ui";
import { avatarTintFromName } from "./form/driver-form-primitives";
import type { AssignDriverRow } from "./types";
import {
  useAssignDriverToRestaurant,
  useAssignDriverToZone,
  useDriverAssignmentPreview,
  useRestaurantAssignDrivers,
  useSearchDriversForAssign,
  useUnassignDriverFromRestaurant,
  useZoneAssignDrivers,
} from "./use-driver-assign";
import { useQuery } from "@tanstack/react-query";
import { fetchZones } from "@/features/zones/use-zones";
import { queryKeys } from "@/lib/query/query-keys";

export type DriverAssignSheetMode = "restaurant" | "zone";

function driverInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function AssignDriverRowCard({
  driver,
  onRemove,
  showRemove,
  removeLabel,
}: {
  driver: AssignDriverRow;
  onRemove?: () => void;
  showRemove?: boolean;
  removeLabel?: string;
}) {
  const t = useTranslations("pages.drivers.assignSheet");

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10 shrink-0">
          {driver.avatar_url ? (
            <AvatarImage src={driver.avatar_url} alt="" />
          ) : null}
          <AvatarFallback className={cn("text-xs font-medium", avatarTintFromName(driver.name))}>
            {driverInitials(driver.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium text-foreground">{driver.name}</p>
            <span className="font-mono text-xs text-muted-foreground">{driver.driver_code}</span>
            <AttendancePill
              onDuty={driver.is_on_duty}
              onDutyLabel={t("onDuty")}
              offDutyLabel={t("offDuty")}
            />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {driver.zone_name ?? t("noZone")} · {driver.partner_name ?? t("noPartner")}
          </p>
          {driver.restaurant_names.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("restaurants")}: {driver.restaurant_names.join(", ")}
            </p>
          ) : null}
          {driver.latitude != null && driver.longitude != null ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              {driver.last_seen_at
                ? t("lastSeen", {
                    lat: driver.latitude.toFixed(4),
                    lng: driver.longitude.toFixed(4),
                  })
                : t("locationPin", {
                    lat: driver.latitude.toFixed(4),
                    lng: driver.longitude.toFixed(4),
                  })}
            </p>
          ) : null}
          {driver.has_in_transit_delivery ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              {t("inTransitBadge")}
            </p>
          ) : null}
          {driver.intake_id ? (
            <Link
              href={`/drivers/${driver.intake_id}`}
              className="mt-2 inline-block text-xs text-primary hover:underline"
            >
              {t("viewDriver")}
            </Link>
          ) : null}
        </div>
        {showRemove && onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            aria-label={removeLabel}
          >
            <UserMinus className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function DriverAssignSheet({
  open,
  onOpenChange,
  mode,
  entityId,
  entityName,
  defaultZoneId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DriverAssignSheetMode;
  entityId: string;
  entityName: string;
  defaultZoneId?: string | null;
}) {
  const t = useTranslations("pages.drivers.assignSheet");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(defaultZoneId ?? null);
  const [replaceAll, setReplaceAll] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);

  const restaurantQuery = useRestaurantAssignDrivers(
    mode === "restaurant" ? entityId : null,
    open && mode === "restaurant",
  );
  const zoneQuery = useZoneAssignDrivers(
    mode === "zone" ? entityId : null,
    open && mode === "zone",
  );

  const assignedDrivers =
    mode === "restaurant" ? (restaurantQuery.data ?? []) : (zoneQuery.data ?? []);
  const isLoadingAssigned =
    mode === "restaurant" ? restaurantQuery.isLoading : zoneQuery.isLoading;

  const { data: zones = [] } = useQuery({
    queryKey: queryKeys.zones.list(),
    queryFn: fetchZones,
    enabled: open,
  });

  const zoneItems = useMemo(
    () =>
      zones.map((z) => ({
        value: z.id,
        label: `${z.name} (${z.code})`,
      })),
    [zones],
  );

  const { data: searchResults = [], isFetching: isSearching } = useSearchDriversForAssign(
    searchQuery,
    open && showAddPanel && searchQuery.trim().length >= 2,
  );

  const { data: preview } = useDriverAssignmentPreview(
    selectedDriverId,
    open && Boolean(selectedDriverId),
  );

  const assignRestaurant = useAssignDriverToRestaurant();
  const assignZone = useAssignDriverToZone();
  const unassign = useUnassignDriverFromRestaurant();

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setSelectedDriverId(null);
      setReplaceAll(false);
      setShowAddPanel(false);
      setZoneId(defaultZoneId ?? null);
    }
  }, [open, defaultZoneId]);

  useEffect(() => {
    if (preview && zoneId == null && preview.zone_id) {
      setZoneId(preview.zone_id);
    }
  }, [preview, zoneId]);

  const handleMutationWarning = (warning?: string) => {
    if (warning === "driver_has_active_delivery") {
      toast.message(t("activeDeliveryWarningTitle"), {
        description: t("activeDeliveryWarningDescription"),
      });
    }
  };

  const handleAssign = async () => {
    if (!selectedDriverId) return;

    if (mode === "restaurant") {
      const result = await assignRestaurant.mutateAsync({
        driverId: selectedDriverId,
        restaurantId: entityId,
        zoneId,
        replaceAll,
      });
      if (result.error) {
        toast.error(t(`errors.${result.error}` as "errors.save_failed"));
        return;
      }
      handleMutationWarning(result.warning);
      toast.success(t("assignedSuccess"));
    } else {
      const result = await assignZone.mutateAsync({
        driverId: selectedDriverId,
        zoneId: entityId,
      });
      if (result.error) {
        toast.error(t(`errors.${result.error}` as "errors.save_failed"));
        return;
      }
      handleMutationWarning(result.warning);
      toast.success(t("zoneAssignedSuccess"));
    }

    setSelectedDriverId(null);
    setSearchQuery("");
    setShowAddPanel(false);
  };

  const handleUnassign = async (driverId: string) => {
    if (mode !== "restaurant") return;
    const result = await unassign.mutateAsync({ driverId, restaurantId: entityId });
    if (result.error) {
      toast.error(t(`errors.${result.error}` as "errors.save_failed"));
      return;
    }
    handleMutationWarning(result.warning);
    toast.success(t("unassignedSuccess"));
  };

  const isPending =
    assignRestaurant.isPending || assignZone.isPending || unassign.isPending;

  const assignedIds = new Set(assignedDrivers.map((d) => d.driver_id));
  const searchItems = searchResults
    .filter((d) => !assignedIds.has(d.driver_id))
    .map((d) => ({
      value: d.driver_id,
      label: d.name,
      hint: `${d.driver_code}${d.zone_name ? ` · ${d.zone_name}` : ""}`,
      keywords: [d.driver_code, d.phone ?? "", ...(d.restaurant_names ?? [])],
    }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            {mode === "restaurant" ? t("titleRestaurant") : t("titleZone")}
          </SheetTitle>
          <SheetDescription>
            {entityName} · {t("assignedCount", { count: assignedDrivers.length })}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4 px-4 pb-6">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>{t("earningsDisclaimer")}</p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">{t("assignedDrivers")}</h3>
            {isLoadingAssigned ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : assignedDrivers.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                {t("emptyAssigned")}
              </p>
            ) : (
              <div className="space-y-2">
                {assignedDrivers.map((driver) => (
                  <AssignDriverRowCard
                    key={driver.driver_id}
                    driver={driver}
                    showRemove={mode === "restaurant"}
                    removeLabel={t("removeDriver")}
                    onRemove={() => void handleUnassign(driver.driver_id)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border pt-4">
            {!showAddPanel ? (
              <Button
                type="button"
                variant="outline"
                className="w-full cursor-pointer"
                onClick={() => setShowAddPanel(true)}
              >
                <Plus className="me-2 h-4 w-4" />
                {t("addDriver")}
              </Button>
            ) : (
              <div className="space-y-3">
                <h3 className="text-sm font-medium">{t("addDriver")}</h3>
                <div className="relative">
                  <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSelectedDriverId(null);
                    }}
                    placeholder={t("searchPlaceholder")}
                    className="ps-9"
                  />
                </div>
                {isSearching ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : searchQuery.trim().length >= 2 && searchItems.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground">{t("noSearchResults")}</p>
                ) : (
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {searchItems.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={cn(
                          "flex w-full cursor-pointer flex-col rounded-md px-3 py-2 text-start text-sm hover:bg-muted",
                          selectedDriverId === item.value && "bg-primary/10",
                        )}
                        onClick={() => setSelectedDriverId(item.value)}
                      >
                        <span className="font-medium">{item.label}</span>
                        {item.hint ? (
                          <span className="text-xs text-muted-foreground">{item.hint}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                )}

                {preview ? (
                  <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                    <AssignDriverRowCard driver={preview} />
                    {mode === "restaurant" ? (
                      <>
                        <div className="space-y-2">
                          <Label>{t("zoneLabel")}</Label>
                          <SearchSelect
                            items={zoneItems}
                            value={zoneId}
                            onChange={(v) => setZoneId(v)}
                            placeholder={t("zonePlaceholder")}
                            searchPlaceholder={t("zonePlaceholder")}
                            clearable={false}
                            className="w-full"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="replace-all"
                            checked={replaceAll}
                            onCheckedChange={(v) => setReplaceAll(v === true)}
                          />
                          <Label htmlFor="replace-all" className="text-sm font-normal">
                            {t("replaceAll")}
                          </Label>
                        </div>
                      </>
                    ) : null}
                    <Button
                      type="button"
                      className="w-full cursor-pointer"
                      disabled={isPending || !selectedDriverId}
                      onClick={() => void handleAssign()}
                    >
                      {isPending ? (
                        <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      ) : null}
                      {mode === "restaurant" ? t("confirmAssign") : t("confirmZoneAssign")}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
