"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Calendar,
  Check,
  Loader2,
  Search,
  Sparkles,
  Store,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { useRestaurantsList } from "@/features/restaurants/use-restaurants";
import { restaurantSearchOptions } from "@/lib/search-options";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { VerificationDriverOption } from "./types";
import {
  useCreateVerification,
  useDriverAssignedRestaurants,
  useVerificationDriverOptions,
} from "./use-verifications";

function todayKuwait(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuwait" }).format(
    new Date(),
  );
}

function driverInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function AddVerificationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.verifications");
  const [driverSearch, setDriverSearch] = useState("");
  const [selectedDriver, setSelectedDriver] = useState<VerificationDriverOption | null>(
    null,
  );
  const [restaurantId, setRestaurantId] = useState("");
  const [showAllRestaurants, setShowAllRestaurants] = useState(false);
  const [serviceDate, setServiceDate] = useState(todayKuwait);
  const [reportedCount, setReportedCount] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const { data: drivers = [] } = useVerificationDriverOptions(driverSearch);
  const { data: restaurants = [] } = useRestaurantsList();
  const { data: assignedRestaurants = [], isLoading: assignedLoading } =
    useDriverAssignedRestaurants(selectedDriver?.id ?? null);

  const publishedRestaurants = useMemo(
    () => restaurants.filter((r) => r.status === "published"),
    [restaurants],
  );

  const filteredRestaurants = useMemo(() => {
    if (showAllRestaurants || !selectedDriver?.partner_id) {
      return publishedRestaurants;
    }
    return publishedRestaurants.filter(
      (r) => r.partner_id === selectedDriver.partner_id,
    );
  }, [publishedRestaurants, selectedDriver, showAllRestaurants]);

  const restaurantItems = useMemo(
    () => restaurantSearchOptions(filteredRestaurants),
    [filteredRestaurants],
  );

  const assignedRestaurantIds = useMemo(
    () => new Set(assignedRestaurants.map((r) => r.id)),
    [assignedRestaurants],
  );

  // Auto-select the only assigned restaurant when there's exactly one and the
  // user hasn't picked anything yet — saves a tap on the common case.
  useEffect(() => {
    if (
      selectedDriver &&
      !restaurantId &&
      assignedRestaurants.length === 1
    ) {
      setRestaurantId(assignedRestaurants[0]!.id);
    }
  }, [selectedDriver, restaurantId, assignedRestaurants]);

  const create = useCreateVerification();
  const maxDate = todayKuwait();

  const reset = () => {
    setDriverSearch("");
    setSelectedDriver(null);
    setRestaurantId("");
    setShowAllRestaurants(false);
    setServiceDate(todayKuwait());
    setReportedCount("");
    setNotes("");
    setFieldErrors({});
  };

  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = () => {
    const errors: Record<string, string> = {};
    if (!selectedDriver) errors.driver = t("errors.missingFields");
    if (!restaurantId) errors.restaurant = t("errors.missingFields");
    if (!serviceDate) errors.date = t("errors.missingFields");

    const count = parseInt(reportedCount, 10);
    if (!Number.isFinite(count) || count < 0) {
      errors.count = t("errors.invalidCount");
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    if (!selectedDriver) return;

    startTransition(async () => {
      const result = await create.mutateAsync({
        driverId: selectedDriver.id,
        restaurantId,
        serviceDate,
        reportedCount: count,
        notes: notes.trim() || undefined,
      });
      if ("error" in result) {
        const key = result.error;
        toast.error(t(`errors.${key}` as "errors.save_failed"), {
          description: result.errorDetail,
          duration: result.errorDetail ? 9000 : undefined,
        });
        return;
      }
      toast.success(t("createSuccess"));
      reset();
      onOpenChange(false);
    });
  };

  const visibleDrivers = selectedDriver
    ? drivers.filter((d) => d.id !== selectedDriver.id)
    : drivers;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-visible rounded-xl p-0 sm:max-w-lg"
        showCloseButton
        closeOutside
      >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pt-4 pb-3">
          <div className="space-y-1.5">
            <Label>{t("fieldDriver")}</Label>
            {selectedDriver ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <Avatar size="sm">
                  <AvatarFallback>{driverInitials(selectedDriver.full_name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{selectedDriver.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {selectedDriver.driver_code}
                    {selectedDriver.employee_id
                      ? ` · ${selectedDriver.employee_id}`
                      : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0 cursor-pointer"
                  aria-label={t("clearDriver")}
                  onClick={() => {
                    setSelectedDriver(null);
                    setDriverSearch("");
                    setRestaurantId("");
                    clearFieldError("driver");
                  }}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={driverSearch}
                    onChange={(e) => {
                      setDriverSearch(e.target.value);
                      clearFieldError("driver");
                    }}
                    placeholder={t("searchDriverPlaceholder")}
                    className="rounded-lg ps-8"
                  />
                </div>
                {driverSearch.trim() && visibleDrivers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("noDriverResults")}</p>
                ) : driverSearch.trim() && visibleDrivers.length > 0 ? (
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
                    <p className="px-2 py-1 text-[11px] text-muted-foreground">
                      {t("selectFromList")}
                    </p>
                    {visibleDrivers.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-start hover:bg-muted/60"
                        onClick={() => {
                          setSelectedDriver(d);
                          setDriverSearch("");
                          setRestaurantId("");
                          setShowAllRestaurants(false);
                          clearFieldError("driver");
                        }}
                      >
                        <Avatar size="sm">
                          <AvatarFallback>{driverInitials(d.full_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{d.full_name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {d.driver_code}
                            {d.employee_id ? ` · ${d.employee_id}` : ""}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
            {fieldErrors.driver ? (
              <p className="text-xs text-destructive">{fieldErrors.driver}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>{t("fieldRestaurant")}</Label>
              {selectedDriver ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto cursor-pointer px-0 text-xs"
                  onClick={() => {
                    setShowAllRestaurants((v) => !v);
                    if (showAllRestaurants) {
                      setRestaurantId("");
                    }
                  }}
                >
                  {showAllRestaurants
                    ? t("showAssignedOnly")
                    : t("showAllRestaurants")}
                </Button>
              ) : null}
            </div>

            {selectedDriver && !showAllRestaurants ? (
              assignedLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("loadingAssignedRestaurants")}
                </div>
              ) : assignedRestaurants.length > 0 ? (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    {t("assignedRestaurantsHint")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {assignedRestaurants.map((r) => {
                      const active = restaurantId === r.id;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setRestaurantId(active ? "" : r.id);
                            clearFieldError("restaurant");
                          }}
                          className={cn(
                            "group inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition",
                            active
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted/60",
                          )}
                          title={r.partner_name}
                        >
                          {active ? (
                            <Check className="size-3 shrink-0" aria-hidden />
                          ) : (
                            <Store className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                          )}
                          <span className="truncate">{r.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                  {t("noAssignedRestaurants")}
                </div>
              )
            ) : null}

            {showAllRestaurants || !selectedDriver || assignedRestaurants.length === 0 ? (
              <SearchSelect
                items={restaurantItems}
                value={restaurantId || null}
                onChange={(v) => {
                  setRestaurantId(v ?? "");
                  clearFieldError("restaurant");
                }}
                placeholder={t("selectRestaurant")}
                searchPlaceholder={t("selectRestaurant")}
                defaultLimit={10}
                recentsKey="verification-add-restaurant"
                className="w-full"
              />
            ) : null}

            {restaurantId && !assignedRestaurantIds.has(restaurantId) && selectedDriver ? (
              <p className="text-[11px] text-muted-foreground">
                {t("nonAssignedRestaurantWarning")}
              </p>
            ) : null}

            {fieldErrors.restaurant ? (
              <p className="text-xs text-destructive">{fieldErrors.restaurant}</p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="service-date">{t("fieldDate")}</Label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="service-date"
                  type="date"
                  max={maxDate}
                  value={serviceDate}
                  onChange={(e) => {
                    setServiceDate(e.target.value);
                    clearFieldError("date");
                  }}
                  className="rounded-lg ps-8"
                />
              </div>
              {fieldErrors.date ? (
                <p className="text-xs text-destructive">{fieldErrors.date}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reported-count">{t("fieldReported")}</Label>
              <Input
                id="reported-count"
                type="number"
                min={0}
                step={1}
                value={reportedCount}
                onChange={(e) => {
                  setReportedCount(e.target.value);
                  clearFieldError("count");
                }}
                className="rounded-lg tabular-nums"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("enterRestaurantCount")}
              </p>
              {fieldErrors.count ? (
                <p className="text-xs text-destructive">{fieldErrors.count}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">{t("fieldNotes")}</Label>
            <Textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <AppModalFooter
          title={t("addVerification")}
          subtitle={t("createSubtitle")}
          meta={
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
              {t("autoReconcileHint")}
            </span>
          }
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9 cursor-pointer rounded-md px-4"
            disabled={isPending}
            onClick={handleSubmit}
          >
            {isPending ? (
              <>
                <Loader2 className="me-1.5 size-4 animate-spin" />
                {t("save")}
              </>
            ) : (
              t("save")
            )}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
