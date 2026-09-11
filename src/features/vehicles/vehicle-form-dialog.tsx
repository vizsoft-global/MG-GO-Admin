"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Bike, Car, Fuel, Wrench } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FieldBlock,
  FieldLabel,
  SectionHeading,
} from "@/features/drivers/form/driver-form-primitives";
import {
  VEHICLE_CAR_TYPES,
  VEHICLE_CONDITIONS,
  VEHICLE_FUEL_COMPANIES,
  VEHICLE_FUEL_TYPES,
  VEHICLE_TYPES_OF_USE,
  defaultFuelMonthlyLimit,
  toKuwaitYmd,
} from "@/features/fleet/fleet-labels";
import { saveVehicle } from "./vehicles-actions";
import { useVehiclePartners } from "./use-vehicles";
import type { VehicleListRow, VehicleTypeRow } from "./types";

export function VehicleFormDialog({
  open,
  vehicle,
  types,
  vehicles = [],
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  vehicle: VehicleListRow | null;
  types: VehicleTypeRow[];
  vehicles?: VehicleListRow[];
  onOpenChange: (open: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("pages.vehicles");
  const [pending, startTransition] = useTransition();
  const { data: partners = [] } = useVehiclePartners();
  const [bikeId, setBikeId] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [chassisNo, setChassisNo] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [modelYear, setModelYear] = useState("");
  const [vehicleTypeKey, setVehicleTypeKey] = useState("bike");
  const [carType, setCarType] = useState("company");
  const [status, setStatus] = useState("active");
  const [condition, setCondition] = useState("running");
  const [typeOfUse, setTypeOfUse] = useState("operational");
  const [locationText, setLocationText] = useState("");
  const [fuelType, setFuelType] = useState("chip");
  const [fuelCompany, setFuelCompany] = useState("mus");
  const [chipNo, setChipNo] = useState("");
  const [fuelLimit, setFuelLimit] = useState("30");
  const [ownerPartnerId, setOwnerPartnerId] = useState<string | null>(null);
  const [replacesVehicleId, setReplacesVehicleId] = useState<string | null>(null);
  const [replacementStartedAt, setReplacementStartedAt] = useState("");

  useEffect(() => {
    if (!open) return;
    setBikeId(vehicle?.bike_id ?? "");
    setRegNumber(vehicle?.reg_number ?? "");
    setChassisNo(vehicle?.chassis_no ?? "");
    setMake(vehicle?.make ?? "");
    setModel(vehicle?.model ?? "");
    setModelYear(vehicle?.model_year != null ? String(vehicle.model_year) : "");
    setVehicleTypeKey(vehicle?.vehicle_type_key ?? "bike");
    setCarType(vehicle?.car_type ?? "company");
    setStatus(vehicle?.status ?? "active");
    setCondition(vehicle?.condition ?? "running");
    setTypeOfUse(vehicle?.type_of_use ?? "operational");
    setLocationText(vehicle?.location_text ?? "");
    setFuelType(vehicle?.fuel_type ?? "chip");
    setFuelCompany(vehicle?.fuel_company ?? "mus");
    setChipNo(vehicle?.chip_no ?? "");
    setFuelLimit(
      vehicle?.fuel_monthly_limit_kwd != null
        ? String(vehicle.fuel_monthly_limit_kwd)
        : String(defaultFuelMonthlyLimit(vehicle?.vehicle_type_key ?? "bike")),
    );
    setOwnerPartnerId(vehicle?.owner_partner_id ?? null);
    setReplacesVehicleId(vehicle?.replaces_vehicle_id ?? null);
    setReplacementStartedAt(toKuwaitYmd(vehicle?.replacement_started_at));
  }, [open, vehicle]);

  const replacementItems = useMemo(
    () =>
      vehicles
        .filter((row) => row.id !== vehicle?.id)
        .map((row) => ({
          value: row.id,
          label: row.reg_number || row.bike_id,
          hint: row.model ?? undefined,
          keywords: [row.bike_id, row.reg_number ?? "", row.chassis_no ?? "", row.model ?? ""],
        })),
    [vehicle?.id, vehicles],
  );

  const partnerItems = useMemo(
    () =>
      partners.map((partner) => ({
        value: partner.id,
        label: partner.name,
        keywords: [partner.name],
      })),
    [partners],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        closeOutside
        className="w-[min(1200px,96vw)] overflow-visible px-5 py-4"
      >
        <form
          className="space-y-3 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData();
            if (vehicle?.id) formData.set("id", vehicle.id);
            formData.set("bikeId", bikeId);
            formData.set("regNumber", regNumber);
            formData.set("chassisNo", chassisNo);
            formData.set("make", make);
            formData.set("model", model);
            formData.set("modelYear", modelYear);
            formData.set("vehicleTypeKey", vehicleTypeKey);
            formData.set("carType", carType);
            formData.set("status", status);
            formData.set("condition", condition);
            formData.set("typeOfUse", typeOfUse);
            formData.set("locationText", locationText);
            formData.set("fuelType", fuelType);
            formData.set("fuelCompany", fuelCompany);
            formData.set("chipNo", chipNo);
            formData.set("fuelMonthlyLimitKwd", fuelLimit);
            if (ownerPartnerId) formData.set("ownerPartnerId", ownerPartnerId);
            if (replacesVehicleId) formData.set("replacesVehicleId", replacesVehicleId);
            formData.set("replacementStartedAt", replacementStartedAt);
            startTransition(async () => {
              const result = await saveVehicle(formData);
              if (result.error || !result.id) {
                toast.error(t(`errors.${result.error ?? "save_failed"}` as "errors.save_failed"));
                return;
              }
              toast.success(t("saved"));
              onSaved(result.id);
            });
          }}
        >
          <SectionHeading icon={Car} accent="primary">
            {t("sectionIdentity")}
          </SectionHeading>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <FieldBlock>
              <FieldLabel required>{t("fieldVehicleId")}</FieldLabel>
              <Input value={bikeId} onChange={(event) => setBikeId(event.target.value)} className="h-9" required />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("colPlate")}</FieldLabel>
              <Input value={regNumber} onChange={(event) => setRegNumber(event.target.value)} className="h-9" />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("colChassis")}</FieldLabel>
              <Input value={chassisNo} onChange={(event) => setChassisNo(event.target.value)} className="h-9 font-mono" />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("colKind")}</FieldLabel>
              <Select
                items={types.map((type) => ({ value: type.key, label: type.label_en }))}
                value={vehicleTypeKey}
                onValueChange={(value) => {
                  if (!value) return;
                  setVehicleTypeKey(value);
                  if (!vehicle) setFuelLimit(String(defaultFuelMonthlyLimit(value)));
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {types.map((type) => (
                    <SelectItem key={type.key} value={type.key} label={type.label_en}>
                      {type.label_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("fieldMake")}</FieldLabel>
              <Input value={make} onChange={(event) => setMake(event.target.value)} className="h-9" />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("fieldModel")}</FieldLabel>
              <Input value={model} onChange={(event) => setModel(event.target.value)} className="h-9" />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("colYear")}</FieldLabel>
              <Input
                value={modelYear}
                onChange={(event) => setModelYear(event.target.value)}
                className="h-9"
                inputMode="numeric"
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("colLocation")}</FieldLabel>
              <Input value={locationText} onChange={(event) => setLocationText(event.target.value)} className="h-9" />
            </FieldBlock>
          </div>

          <SectionHeading icon={Bike} accent="primary">
            {t("sectionOwnership")}
          </SectionHeading>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <FieldBlock>
              <FieldLabel>{t("colCarType")}</FieldLabel>
              <Select
                items={VEHICLE_CAR_TYPES.map((value) => ({ value, label: t(`carType.${value}`) }))}
                value={carType}
                onValueChange={(value) => {
                  if (value) setCarType(value);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_CAR_TYPES.map((value) => (
                    <SelectItem key={value} value={value} label={t(`carType.${value}`)}>
                      {t(`carType.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">{t("carTypeHint")}</p>
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("colCarsCompany")}</FieldLabel>
              <SearchSelect
                items={partnerItems}
                value={ownerPartnerId}
                onChange={setOwnerPartnerId}
                placeholder={t("carsCompanyPlaceholder")}
                searchPlaceholder={t("carsCompanySearch")}
                recentsKey="vehicle-owner-partner"
                className="h-9"
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("colCondition")}</FieldLabel>
              <Select
                items={VEHICLE_CONDITIONS.map((value) => ({ value, label: t(`condition.${value}`) }))}
                value={condition}
                onValueChange={(value) => {
                  if (value) setCondition(value);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_CONDITIONS.map((value) => (
                    <SelectItem key={value} value={value} label={t(`condition.${value}`)}>
                      {t(`condition.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("colTypeOfUse")}</FieldLabel>
              <Select
                items={VEHICLE_TYPES_OF_USE.map((value) => ({ value, label: t(`typeOfUse.${value}`) }))}
                value={typeOfUse}
                onValueChange={(value) => {
                  if (value) setTypeOfUse(value);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_TYPES_OF_USE.map((value) => (
                    <SelectItem key={value} value={value} label={t(`typeOfUse.${value}`)}>
                      {t(`typeOfUse.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">{t("typeOfUseHint")}</p>
            </FieldBlock>
          </div>

          <SectionHeading icon={Fuel} accent="success">
            {t("sectionFuel")}
          </SectionHeading>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <FieldBlock>
              <FieldLabel>{t("colFuelType")}</FieldLabel>
              <Select
                items={VEHICLE_FUEL_TYPES.map((value) => ({ value, label: t(`fuelType.${value}`) }))}
                value={fuelType}
                onValueChange={(value) => {
                  if (value) setFuelType(value);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_FUEL_TYPES.map((value) => (
                    <SelectItem key={value} value={value} label={t(`fuelType.${value}`)}>
                      {t(`fuelType.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("colFuelCompany")}</FieldLabel>
              <Select
                items={VEHICLE_FUEL_COMPANIES.map((value) => ({
                  value,
                  label: t(`fuelCompany.${value}`),
                }))}
                value={fuelCompany}
                onValueChange={(value) => {
                  if (value) setFuelCompany(value);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VEHICLE_FUEL_COMPANIES.map((value) => (
                    <SelectItem key={value} value={value} label={t(`fuelCompany.${value}`)}>
                      {t(`fuelCompany.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("colChip")}</FieldLabel>
              <Input value={chipNo} onChange={(event) => setChipNo(event.target.value)} className="h-9 font-mono" />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("fieldFuelLimit")}</FieldLabel>
              <Input
                value={fuelLimit}
                onChange={(event) => setFuelLimit(event.target.value)}
                className="h-9"
                inputMode="decimal"
              />
            </FieldBlock>
          </div>

          <SectionHeading icon={Wrench} accent="warning">
            {t("sectionOperations")}
          </SectionHeading>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <FieldBlock>
              <FieldLabel>{t("colStatus")}</FieldLabel>
              <Select
                items={[
                  { value: "active", label: t("statusActive") },
                  { value: "suspended", label: t("statusSuspended") },
                  { value: "maintenance", label: t("statusMaintenance") },
                ]}
                value={status}
                onValueChange={(value) => {
                  if (value) setStatus(value);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active" label={t("statusActive")}>
                    {t("statusActive")}
                  </SelectItem>
                  <SelectItem value="suspended" label={t("statusSuspended")}>
                    {t("statusSuspended")}
                  </SelectItem>
                  <SelectItem value="maintenance" label={t("statusMaintenance")}>
                    {t("statusMaintenance")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">{t("statusHint")}</p>
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("fieldReplaces")}</FieldLabel>
              <SearchSelect
                items={replacementItems}
                value={replacesVehicleId}
                onChange={setReplacesVehicleId}
                placeholder={t("replacesPlaceholder")}
                searchPlaceholder={t("replacesSearch")}
                recentsKey="vehicle-replaces"
                className="h-9"
              />
            </FieldBlock>
            <FieldBlock>
              <FieldLabel>{t("colSince")}</FieldLabel>
              <Input
                type="date"
                value={replacementStartedAt}
                onChange={(event) => setReplacementStartedAt(event.target.value)}
                className="h-9"
                disabled={!replacesVehicleId}
              />
            </FieldBlock>
          </div>

          <AppModalFooter title={vehicle ? t("editTitle") : t("addTitle")} subtitle={t("formSubtitle")}>
            <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" className="h-9" disabled={pending}>
              {t("save")}
            </Button>
          </AppModalFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
