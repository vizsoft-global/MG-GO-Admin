"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query/query-keys";
import { saveMaintenanceSchedule, saveMaintenanceSettings } from "./service-actions";
import { serviceErrorKey, useServiceTypeCatalog, useVehicleModels } from "./use-service";
import type {
  MaintenanceDoneRecord,
  MaintenanceVehicle,
} from "./service-maintenance-model";
import type {
  MaintenanceScheduleRow,
  MaintenanceSettings,
} from "./types";

type MaintenanceData = {
  vehicles: MaintenanceVehicle[];
  doneRecords: MaintenanceDoneRecord[];
  schedules: MaintenanceScheduleRow[];
  settings: MaintenanceSettings;
};

export function ServiceScheduleDialog({
  open,
  onOpenChange,
  data,
  provisional,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: MaintenanceData | null;
  provisional: boolean;
}) {
  const t = useTranslations("pages.fleetService");
  const queryClient = useQueryClient();
  const models = useVehicleModels();
  const types = useServiceTypeCatalog();

  const settings = data?.settings;
  const [km, setKm] = useState(String(settings?.km_interval ?? 10000));
  const [days, setDays] = useState(String(settings?.day_interval ?? 180));
  const [alertKm, setAlertKm] = useState(String(settings?.alert_km ?? 500));
  const [alertDays, setAlertDays] = useState(String(settings?.alert_days ?? 14));
  const [scope, setScope] = useState<"vehicle" | "model">("model");
  const [vehicleId, setVehicleId] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [serviceTypeKey, setServiceTypeKey] = useState("");
  const [rowKm, setRowKm] = useState("10000");
  const [rowDays, setRowDays] = useState("180");
  const [saving, setSaving] = useState(false);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.all() });
  }

  async function saveDefaults(confirm: boolean) {
    setSaving(true);
    const result = await saveMaintenanceSettings({
      kmInterval: Number(km || 0),
      dayInterval: Number(days || 0),
      alertKm: Number(alertKm || 0),
      alertDays: Number(alertDays || 0),
      confirm,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(confirm ? t("maintenance.confirmed") : t("saved"));
    refresh();
  }

  async function addSchedule() {
    setSaving(true);
    const result = await saveMaintenanceSchedule({
      scope,
      vehicleId: scope === "vehicle" ? vehicleId : null,
      makeModelKey: scope === "model" ? modelKey : null,
      serviceTypeKey,
      serviceTypeLabel:
        (types.data ?? []).find((row) => row.key === serviceTypeKey)?.label_en ?? null,
      kmInterval: Number(rowKm || 0),
      dayInterval: Number(rowDays || 0),
      alertKm: Number(alertKm || 0),
      alertDays: Number(alertDays || 0),
      isActive: true,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(t("saved"));
    setVehicleId("");
    setModelKey("");
    setServiceTypeKey("");
    refresh();
  }

  const vehicleItems = (data?.vehicles ?? []).map((vehicle) => ({
    value: vehicle.id,
    label: [vehicle.plate, vehicle.model].filter(Boolean).join(" · "),
  }));
  const modelItems = (models.data ?? []).map((row) => ({
    value: row.key,
    label: row.label,
    hint: String(row.vehicles),
  }));
  const typeItems = (types.data ?? []).map((row) => ({
    value: row.key,
    label: row.label_en,
    hint: t(`categories.${row.category}`),
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton closeOutside className="w-[min(860px,96vw)]">
        <div className="max-h-[min(72dvh,620px)] space-y-4 overflow-y-auto px-5 pt-4 pb-2">
          <section className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">{t("maintenance.defaultsTitle")}</p>
              {provisional ? (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                  {t("maintenance.provisionalTag")}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-emerald-50 text-emerald-700"
                >
                  {t("maintenance.confirmedTag")}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("maintenance.defaultsHint")}</p>
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("maintenance.kmInterval")}</span>
                <Input
                  type="number"
                  min={0}
                  className="h-9 tabular-nums"
                  value={km}
                  onChange={(event) => setKm(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("maintenance.dayInterval")}</span>
                <Input
                  type="number"
                  min={0}
                  className="h-9 tabular-nums"
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("maintenance.alertKm")}</span>
                <Input
                  type="number"
                  min={0}
                  className="h-9 tabular-nums"
                  value={alertKm}
                  onChange={(event) => setAlertKm(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("maintenance.alertDays")}</span>
                <Input
                  type="number"
                  min={0}
                  className="h-9 tabular-nums"
                  value={alertDays}
                  onChange={(event) => setAlertDays(event.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={saving}
                onClick={() => void saveDefaults(false)}
              >
                {t("actions.save")}
              </Button>
              {provisional ? (
                <Button
                  type="button"
                  className="h-9"
                  disabled={saving}
                  onClick={() => void saveDefaults(true)}
                >
                  {t("actions.confirmIntervals")}
                </Button>
              ) : null}
            </div>
          </section>

          <section className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">{t("maintenance.schedulesTitle")}</p>
            {(data?.schedules ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("maintenance.noSchedules")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {(data?.schedules ?? []).map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{t(`maintenance.scope.${row.scope}`)}</Badge>
                    <span className="truncate">{row.service_type_label ?? row.service_type_key}</span>
                    <span className="text-muted-foreground">
                      {row.vehicle_id ?? row.make_model_key}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {row.km_interval} km · {row.day_interval} d
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("maintenance.scopeLabel")}</span>
                <Select
                  items={[
                    { value: "model", label: t("maintenance.scope.model") },
                    { value: "vehicle", label: t("maintenance.scope.vehicle") },
                  ]}
                  value={scope}
                  onValueChange={(value) => setScope(value as "vehicle" | "model")}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="model">{t("maintenance.scope.model")}</SelectItem>
                    <SelectItem value="vehicle">{t("maintenance.scope.vehicle")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 text-xs">
                <span className="block text-muted-foreground">
                  {scope === "vehicle" ? t("form.vehicle") : t("maintenance.makeModel")}
                </span>
                <SearchSelect
                  items={scope === "vehicle" ? vehicleItems : modelItems}
                  value={scope === "vehicle" ? vehicleId || null : modelKey || null}
                  onChange={(next) =>
                    scope === "vehicle" ? setVehicleId(next ?? "") : setModelKey(next ?? "")
                  }
                  placeholder={t("filters.any")}
                />
              </div>
              <div className="space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("form.serviceType")}</span>
                <SearchSelect
                  items={typeItems}
                  value={serviceTypeKey || null}
                  onChange={(next) => setServiceTypeKey(next ?? "")}
                  placeholder={t("form.selectType")}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs">
                  <span className="block text-muted-foreground">{t("maintenance.kmInterval")}</span>
                  <Input
                    type="number"
                    min={0}
                    className="h-9 tabular-nums"
                    value={rowKm}
                    onChange={(event) => setRowKm(event.target.value)}
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="block text-muted-foreground">
                    {t("maintenance.dayInterval")}
                  </span>
                  <Input
                    type="number"
                    min={0}
                    className="h-9 tabular-nums"
                    value={rowDays}
                    onChange={(event) => setRowDays(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              disabled={saving || !serviceTypeKey || (scope === "vehicle" ? !vehicleId : !modelKey)}
              onClick={() => void addSchedule()}
            >
              {t("actions.addSchedule")}
            </Button>
          </section>
        </div>
        <AppModalFooter title={t("maintenance.schedulesTitle")}>
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => onOpenChange(false)}
          >
            {t("actions.close")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
