"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query/query-keys";
import {
  CLIENT_ID_MAX_LENGTH,
  CLIENT_NAME_MAX_LENGTH,
} from "../driver-client-fields";
import { DriverRestaurantPicker } from "../driver-restaurant-picker";
import { hasOpsAssignment } from "../driver-assignment";
import { saveDriverProjectSettings } from "../drivers-actions";
import { SearchableSelect } from "../form/searchable-select";
import { DRIVER_PROJECT_LABEL, type DriverProjectKey } from "@/features/fleet/fleet-labels";
import type { DriverAccountStatus, DriverDetailModel } from "../types";
import { useDriverFormOptions } from "../use-driver-form-options";

const FIELD =
  "h-[42px] min-h-[42px] w-full rounded-lg border border-[#D7D7DF] bg-card px-3 text-sm shadow-none";
const PICKER =
  "h-[42px] min-h-[42px] rounded-lg border-[#D7D7DF] bg-card shadow-none";

export function ProjectTab({
  driver,
  canManage,
  opsNotRequired,
}: {
  driver: DriverDetailModel;
  canManage: boolean;
  opsNotRequired: boolean;
}) {
  const t = useTranslations("pages.driverDetail.project");
  const tNew = useTranslations("pages.driverNew");
  const queryClient = useQueryClient();
  const optionsQuery = useDriverFormOptions();
  const [projectKey, setProjectKey] = useState<DriverProjectKey | "">(driver.project_key ?? "");
  const [zoneId, setZoneId] = useState(driver.zone_id ?? "");
  const [restaurantIds, setRestaurantIds] = useState(driver.restaurant_ids);
  const [vehicleId, setVehicleId] = useState(driver.vehicle_id ?? "");
  const [vehicleType, setVehicleType] = useState(driver.vehicle_type_key === "car" ? "car" : "bike");
  const [clientId, setClientId] = useState(driver.client_id ?? "");
  const [platform, setPlatform] = useState(driver.client_name ?? "");
  const [accommodation, setAccommodation] = useState(driver.accommodation ?? "");
  const [accountStatus, setAccountStatus] = useState<DriverAccountStatus>(driver.account_status);
  const [saving, setSaving] = useState(false);

  const locked = !canManage || saving || !driver.intake_id;
  const draftReady = opsNotRequired || hasOpsAssignment(zoneId, restaurantIds);

  const zoneItems = useMemo(() => {
    const items = (optionsQuery.data?.zones ?? []).map((zone) => ({
      value: zone.id,
      label: `${zone.name} (${zone.code})`,
    }));
    if (driver.zone_id && !items.some((item) => item.value === driver.zone_id)) {
      items.unshift({ value: driver.zone_id, label: driver.zone_label || driver.zone_id });
    }
    return items;
  }, [driver.zone_id, driver.zone_label, optionsQuery.data?.zones]);

  const vehicleItems = useMemo(() => {
    const items = (optionsQuery.data?.vehicles ?? []).map((vehicle) => ({
      value: vehicle.id,
      label: `${vehicle.bike_id}${vehicle.reg_number ? ` · ${vehicle.reg_number}` : ""}`,
    }));
    if (driver.vehicle_id && !items.some((item) => item.value === driver.vehicle_id)) {
      items.unshift({
        value: driver.vehicle_id,
        label: driver.vehicle_label || driver.vehicle_id,
      });
    }
    return items;
  }, [driver.vehicle_id, driver.vehicle_label, optionsQuery.data?.vehicles]);

  const restaurants = useMemo(() => {
    const list = [...(optionsQuery.data?.restaurants ?? [])];
    driver.restaurant_ids.forEach((id, index) => {
      if (list.some((restaurant) => restaurant.id === id)) return;
      list.push({
        id,
        name: driver.restaurant_names[index] || id,
        partner_id: null,
        status: "published",
      });
    });
    return list.map((restaurant) =>
      restaurantIds.includes(restaurant.id) && restaurant.status !== "published"
        ? { ...restaurant, status: "published" as const }
        : restaurant,
    );
  }, [driver.restaurant_ids, driver.restaurant_names, optionsQuery.data?.restaurants, restaurantIds]);

  const pickStatus = (next: "active" | "suspended") => {
    if (locked || !driver.linked_profile_id) return;
    if (next === "active" && !draftReady) {
      toast.error(tNew("errors.missing_assignment"));
      return;
    }
    setAccountStatus(next);
  };

  const pickVehicle = (next: string) => {
    setVehicleId(next);
    const vehicle = optionsQuery.data?.vehicles.find((item) => item.id === next);
    if (vehicle?.vehicle_type_key === "car" || vehicle?.vehicle_type_key === "bike") {
      setVehicleType(vehicle.vehicle_type_key);
    }
  };

  const save = async () => {
    if (locked || !driver.intake_id) return;
    setSaving(true);
    const form = new FormData();
    form.set("intakeId", driver.intake_id);
    form.set("projectKey", projectKey);
    form.set("zoneId", zoneId);
    form.set("vehicleId", vehicleId);
    form.set("vehicleTypeKey", vehicleType);
    form.set("clientId", clientId);
    form.set("clientName", platform);
    form.set("accommodation", accommodation);
    for (const id of restaurantIds) form.append("restaurantIds", id);
    if (
      driver.linked_profile_id &&
      accountStatus !== driver.account_status &&
      (accountStatus === "active" || accountStatus === "suspended")
    ) {
      form.set("accountStatus", accountStatus);
    }
    const result = await saveDriverProjectSettings(form);
    setSaving(false);
    if (result.error) {
      if (result.error === "invalid_client_id") toast.error(t("invalidClientId"));
      else if (result.error === "invalid_client_name") toast.error(t("invalidClientName"));
      else toast.error(tNew(`errors.${result.error}` as "errors.save_failed"));
      return;
    }
    toast.success(t("saved"));
    await queryClient.invalidateQueries({ queryKey: queryKeys.drivers.detail(driver.id) });
  };

  const projects: { key: DriverProjectKey | ""; label: string }[] = [
    { key: "americana", label: DRIVER_PROJECT_LABEL.americana },
    { key: "keeta", label: DRIVER_PROJECT_LABEL.keeta },
    { key: "five_guys", label: DRIVER_PROJECT_LABEL.five_guys },
    { key: "", label: t("projectUnset") },
  ];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-bold text-foreground">{t("title")}</h2>
          <p className="text-[13px] text-[#565868]">{t("subtitle")}</p>
        </div>
        <button
          type="submit"
          disabled={locked}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-[#292A3F] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1c1d2e] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? t("saving") : t("save")}
        </button>
      </div>

      {!driver.intake_id ? <p className="text-[13px] text-[#565868]">{t("needsIntake")}</p> : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-4 rounded-[14px] border border-border bg-card px-6 py-5">
          <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#B5401F]">{t("assignment")}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label className="text-[13px] font-medium text-[#565868]">{t("fields.project")}</Label>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("fields.project")}>
                {projects.map((item) => {
                  const pressed = projectKey === item.key;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      disabled={locked}
                      aria-pressed={pressed}
                      onClick={() => setProjectKey(item.key)}
                      className={
                        pressed
                          ? "min-h-[42px] rounded-lg border-[1.5px] border-[#292A3F] bg-[#ECECF3] text-sm font-bold text-foreground"
                          : "min-h-[42px] rounded-lg border border-[#D7D7DF] bg-card text-sm font-medium text-foreground"
                      }
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-[13px] font-medium text-[#565868]">{t("fields.zone")}</Label>
              <SearchableSelect
                value={zoneId}
                onValueChange={setZoneId}
                items={zoneItems}
                placeholder={t("placeholders.zone")}
                searchPlaceholder={t("placeholders.zone")}
                recentsKey="driver-project-zone"
                disabled={locked}
                className={PICKER}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[13px] font-medium text-[#565868]">{t("fields.restaurants")}</Label>
              <DriverRestaurantPicker
                restaurants={restaurants}
                selectedIds={restaurantIds}
                onChange={setRestaurantIds}
                disabled={locked}
                variant="compact"
                emptyLabel={t("placeholders.restaurants")}
                triggerClassName={PICKER}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[13px] font-medium text-[#565868]">{t("fields.vehicle")}</Label>
              <SearchableSelect
                value={vehicleId}
                onValueChange={pickVehicle}
                items={vehicleItems}
                placeholder={t("placeholders.vehicle")}
                searchPlaceholder={t("fields.vehicle")}
                recentsKey="driver-project-vehicle"
                disabled={locked}
                className={PICKER}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[13px] font-medium text-[#565868]">{t("fields.vehicleType")}</Label>
              <Select
                value={vehicleType}
                onValueChange={(value) => setVehicleType(value === "car" ? "car" : "bike")}
                disabled={locked}
              >
                <SelectTrigger className={FIELD}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bike">{t("vehicleBike")}</SelectItem>
                  <SelectItem value="car">{t("vehicleCar")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[13px] font-medium text-[#565868]">{t("fields.clientId")}</Label>
              <Input
                value={clientId}
                maxLength={CLIENT_ID_MAX_LENGTH}
                disabled={locked}
                placeholder={t("placeholders.clientId")}
                onChange={(event) => setClientId(event.target.value)}
                className={FIELD}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[13px] font-medium text-[#565868]">{t("fields.platform")}</Label>
              <Input
                value={platform}
                maxLength={CLIENT_NAME_MAX_LENGTH}
                disabled={locked}
                placeholder={t("placeholders.platform")}
                onChange={(event) => setPlatform(event.target.value)}
                className={FIELD}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label className="text-[13px] font-medium text-[#565868]">{t("fields.accommodation")}</Label>
              <Input
                value={accommodation}
                maxLength={CLIENT_NAME_MAX_LENGTH}
                disabled={locked}
                placeholder={t("placeholders.accommodation")}
                onChange={(event) => setAccommodation(event.target.value)}
                className={FIELD}
              />
            </div>
            <p className="text-[13px] text-[#565868] sm:col-span-2">{t("assignmentHint")}</p>
          </div>
        </section>

        <section className="flex min-w-0 flex-[1_1_360px] flex-col gap-4 rounded-[14px] border border-border bg-card px-6 py-5">
          <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#B5401F]">{t("operations")}</h3>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[13px] font-medium text-[#565868]">{t("driverStatus")}</Label>
            {driver.linked_profile_id ? (
              <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("driverStatus")}>
                {(
                  [
                    ["active", t("statusActive")],
                    ["suspended", t("statusInactive")],
                  ] as const
                ).map(([key, label]) => {
                  const pressed = accountStatus === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={locked}
                      aria-pressed={pressed}
                      onClick={() => pickStatus(key)}
                      className={
                        pressed
                          ? "min-h-[42px] rounded-lg border-[1.5px] border-[#292A3F] bg-[#ECECF3] text-sm font-bold text-foreground"
                          : "min-h-[42px] rounded-lg border border-[#D7D7DF] bg-card text-sm font-medium text-foreground"
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] text-[#565868]">{t("needsLink")}</p>
            )}
            <p className="text-[13px] text-[#565868]">{t("driverStatusHint")}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[13px] font-medium text-[#565868]">{t("assetsIssued")}</Label>
            {driver.assigned_assets.length === 0 ? (
              <p className="text-sm text-[#565868]">—</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {driver.assigned_assets.map((asset) => (
                  <span
                    key={asset.catalog_item_id}
                    className="rounded-md border border-[#D7D7DF] bg-card px-2.5 py-1 text-[12px] text-foreground"
                  >
                    {asset.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </form>
  );
}
