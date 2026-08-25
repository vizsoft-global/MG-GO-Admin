"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveVehicle } from "./vehicles-actions";
import type { VehicleListRow, VehicleTypeRow } from "./types";

export function VehicleFormDialog({
  open,
  vehicle,
  types,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  vehicle: VehicleListRow | null;
  types: VehicleTypeRow[];
  onOpenChange: (open: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("pages.vehicles");
  const [pending, startTransition] = useTransition();
  const [bikeId, setBikeId] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [vehicleTypeKey, setVehicleTypeKey] = useState("bike");
  const [projectType, setProjectType] = useState("group");
  const [status, setStatus] = useState("active");

  useEffect(() => {
    if (!open) return;
    setBikeId(vehicle?.bike_id ?? "");
    setRegNumber(vehicle?.reg_number ?? "");
    setMake(vehicle?.make ?? "");
    setModel(vehicle?.model ?? "");
    setVehicleTypeKey(vehicle?.vehicle_type_key ?? "bike");
    setProjectType(vehicle?.project_type ?? "group");
    setStatus(vehicle?.status ?? "active");
  }, [open, vehicle]);

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
            formData.set("make", make);
            formData.set("model", model);
            formData.set("vehicleTypeKey", vehicleTypeKey);
            formData.set("projectType", projectType);
            formData.set("status", status);
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
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                {t("fieldVehicleId")} <span className="text-destructive">*</span>
              </Label>
              <Input
                value={bikeId}
                onChange={(event) => setBikeId(event.target.value)}
                className="h-9"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("fieldReg")}</Label>
              <Input
                value={regNumber}
                onChange={(event) => setRegNumber(event.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("colType")}</Label>
              <Select
                items={types.map((type) => ({ value: type.key, label: type.label_en }))}
                value={vehicleTypeKey}
                onValueChange={(value) => {
                  if (value) setVehicleTypeKey(value);
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
            </div>
            <div className="space-y-1.5">
              <Label>{t("colStatus")}</Label>
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
            </div>
            <div className="space-y-1.5">
              <Label>{t("fieldMake")}</Label>
              <Input value={make} onChange={(event) => setMake(event.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("fieldModel")}</Label>
              <Input value={model} onChange={(event) => setModel(event.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label>{t("fieldProject")}</Label>
              <Select
                items={[
                  { value: "group", label: t("projectGroup") },
                  { value: "rent", label: t("projectRent") },
                ]}
                value={projectType}
                onValueChange={(value) => {
                  if (value) setProjectType(value);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="group" label={t("projectGroup")}>
                    {t("projectGroup")}
                  </SelectItem>
                  <SelectItem value="rent" label={t("projectRent")}>
                    {t("projectRent")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
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
