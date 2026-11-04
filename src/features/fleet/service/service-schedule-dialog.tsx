"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query/query-keys";
import {
  deleteMaintenanceSchedule,
  saveMaintenanceSchedule,
  saveMaintenanceSettings,
} from "./service-actions";
import { SCHEDULED_PROGRAMS, type ScheduledProgramKey } from "./service-programs";
import { makeKey, makeModelKey } from "./service-maintenance-model";
import { serviceErrorKey } from "./use-service";
import type {
  MaintenanceDoneRecord,
  MaintenanceVehicle,
} from "./service-maintenance-model";
import type {
  MaintenanceExclusion,
  MaintenanceRuleScope,
  MaintenanceScheduleRow,
  MaintenanceSettings,
  VehicleDayDistance,
} from "./types";

type MaintenanceData = {
  vehicles: MaintenanceVehicle[];
  doneRecords: MaintenanceDoneRecord[];
  schedules: MaintenanceScheduleRow[];
  settings: MaintenanceSettings;
  exclusions: MaintenanceExclusion[];
  distances: VehicleDayDistance[];
};


const SCOPES: MaintenanceRuleScope[] = ["vehicle", "make_model", "make", "vehicle_type"];

/**
 * The interval rules matrix.
 *
 * One table, one row per rule: **program × scope** on the left, then the four
 * numbers that decide it — km, days, alert km, alert days. `0` in a km or day
 * cell is a real value: it means the rule does not track that dimension, and the
 * maintenance tab prints `—` instead of `Unknown` for it.
 *
 * `Confirm intervals` is still the only action that clears `provisional`, and it
 * is the Fleet Team's own approval — it stamps who confirmed the fleet defaults
 * and when, so an unapproved default can never quietly look authoritative.
 */
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

  const settings = data?.settings;
  const [km, setKm] = useState(String(settings?.km_interval ?? 10000));
  const [days, setDays] = useState(String(settings?.day_interval ?? 180));
  const [alertKm, setAlertKm] = useState(String(settings?.alert_km ?? 500));
  const [alertDays, setAlertDays] = useState(String(settings?.alert_days ?? 5));
  const [saving, setSaving] = useState(false);

  // The add row.
  const [programKey, setProgramKey] = useState<ScheduledProgramKey>("oil_change");
  const [scope, setScope] = useState<MaintenanceRuleScope>("vehicle_type");
  const [vehicleType, setVehicleType] = useState("car");
  const [target, setTarget] = useState("");
  const [newKm, setNewKm] = useState("");
  const [newDays, setNewDays] = useState("");

  const vehicleItems = useMemo(
    () =>
      (data?.vehicles ?? []).map((vehicle) => ({
        value: vehicle.id,
        label: `${vehicle.plate} · ${vehicle.model ?? "—"}`,
      })),
    [data?.vehicles],
  );
  const makeItems = useMemo(() => {
    const set = new Set<string>();
    for (const vehicle of data?.vehicles ?? []) {
      const key = makeKey(vehicle.make);
      if (key) set.add(key);
    }
    return [...set].sort().map((key) => ({ value: key, label: key }));
  }, [data?.vehicles]);

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

  async function saveRow(row: MaintenanceScheduleRow, patch: Partial<MaintenanceScheduleRow>) {
    setSaving(true);
    const result = await saveMaintenanceSchedule({
      id: row.id,
      scope: row.scope,
      vehicleId: row.vehicle_id,
      makeModelKey: row.make_model_key,
      makeKey: row.make_key,
      vehicleTypeKey: row.vehicle_type_key,
      serviceTypeKey: row.service_type_key,
      serviceTypeLabel: row.service_type_label,
      kmInterval: patch.km_interval ?? row.km_interval,
      dayInterval: patch.day_interval ?? row.day_interval,
      alertKm: patch.alert_km ?? row.alert_km,
      alertDays: patch.alert_days ?? row.alert_days,
      isActive: patch.is_active ?? row.is_active,
    });
    setSaving(false);
    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    toast.success(t("saved"));
    refresh();
  }

  async function addRule() {
    setSaving(true);
    const label = SCHEDULED_PROGRAMS.find((entry) => entry.key === programKey)?.labelEn ?? programKey;
    const result = await saveMaintenanceSchedule({
      scope,
      vehicleId: scope === "vehicle" ? target : null,
      makeModelKey: scope === "make_model" ? target || makeModelKey("", "") : null,
      makeKey: scope === "make" ? target : null,
      vehicleTypeKey: scope === "vehicle_type" ? vehicleType : null,
      serviceTypeKey: programKey,
      serviceTypeLabel: label,
      kmInterval: Number(newKm || 0),
      dayInterval: Number(newDays || 0),
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
    setTarget("");
    setNewKm("");
    setNewDays("");
    refresh();
  }

  async function removeRule(row: MaintenanceScheduleRow) {
    setSaving(true);
    const result = await deleteMaintenanceSchedule({ id: row.id });
    setSaving(false);
    if ("error" in result) {
      toast.error(t(serviceErrorKey(result.error)));
      return;
    }
    refresh();
  }

  const scopeLabel = (row: MaintenanceScheduleRow): string => {
    switch (row.scope) {
      case "vehicle":
        return data?.vehicles.find((vehicle) => vehicle.id === row.vehicle_id)?.plate ?? row.vehicle_id ?? "—";
      case "make_model":
        return row.make_model_key ?? "—";
      case "make":
        return row.make_key ?? "—";
      default:
        return row.vehicle_type_key ?? "—";
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton closeOutside className="w-[min(1080px,96vw)]">
        <div className="max-h-[74vh] space-y-4 overflow-y-auto px-5 pt-4 pb-2">
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{t("maintenance.defaultsTitle")}</h3>
              <Badge
                variant="outline"
                className={
                  provisional
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700"
                }
              >
                {provisional ? t("maintenance.provisionalTag") : t("maintenance.confirmedTag")}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{t("maintenance.defaultsHint")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  [t("maintenance.kmInterval"), km, setKm],
                  [t("maintenance.dayInterval"), days, setDays],
                  [t("maintenance.alertKm"), alertKm, setAlertKm],
                  [t("maintenance.alertDays"), alertDays, setAlertDays],
                ] as const
              ).map(([label, value, setValue]) => (
                <label key={label} className="space-y-1 text-xs">
                  <span className="block text-muted-foreground">{label}</span>
                  <Input
                    type="number"
                    min={0}
                    className="h-9 tabular-nums"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={saving}
                onClick={() => void saveDefaults(false)}
              >
                {t("actions.save")}
              </Button>
              <Button
                type="button"
                className="h-9"
                disabled={saving || !provisional}
                onClick={() => void saveDefaults(true)}
              >
                {t("actions.confirmIntervals")}
              </Button>
            </div>
          </section>


          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t("maintenance.rulesTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("maintenance.rulesHint")}</p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-start">{t("maintenance.cols.program")}</th>
                    <th className="px-2 py-1 text-start">{t("maintenance.scopeLabel")}</th>
                    <th className="px-2 py-1 text-start">{t("maintenance.applyTo")}</th>
                    <th className="px-2 py-1 text-start">{t("maintenance.kmInterval")}</th>
                    <th className="px-2 py-1 text-start">{t("maintenance.dayInterval")}</th>
                    <th className="px-2 py-1 text-start">{t("maintenance.alertKm")}</th>
                    <th className="px-2 py-1 text-start">{t("maintenance.alertDays")}</th>
                    <th className="px-2 py-1 text-start">{t("maintenance.cols.status")}</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {(data?.schedules ?? []).map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-2 py-1 font-medium">
                        {SCHEDULED_PROGRAMS.find((entry) => entry.key === row.service_type_key)
                          ?.labelEn ?? row.service_type_key}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {t(`maintenance.scope.${row.scope}`)}
                      </td>
                      <td className="px-2 py-1 tabular-nums">{scopeLabel(row)}</td>
                      {(
                        [
                          ["km_interval", row.km_interval],
                          ["day_interval", row.day_interval],
                          ["alert_km", row.alert_km],
                          ["alert_days", row.alert_days],
                        ] as const
                      ).map(([field, current]) => (
                        <td key={field} className="px-1 py-1">
                          <Input
                            type="number"
                            min={0}
                            defaultValue={current}
                            className="h-8 w-20 tabular-nums"
                            onBlur={(event) => {
                              const next = Number(event.target.value || 0);
                              if (next !== current) void saveRow(row, { [field]: next });
                            }}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1">
                        <Badge
                          variant="outline"
                          className={
                            row.is_active
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-border bg-muted text-muted-foreground"
                          }
                        >
                          {row.is_active
                            ? t("maintenance.activeRule")
                            : t("maintenance.inactiveRule")}
                        </Badge>
                      </td>
                      <td className="px-2 py-1 text-end">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 px-2"
                          disabled={saving}
                          onClick={() => void removeRule(row)}
                          aria-label={t("maintenance.removeRule")}
                          title={t("maintenance.removeRule")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(data?.schedules ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-2 py-3 text-center text-muted-foreground">
                        {t("maintenance.noSchedules")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>


          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t("maintenance.addRuleTitle")}</h3>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("maintenance.cols.program")}</span>
                <Select
                  items={SCHEDULED_PROGRAMS.map((entry) => ({
                    value: entry.key,
                    label: entry.labelEn,
                  }))}
                  value={programKey}
                  onValueChange={(next) =>
                    setProgramKey((next ?? "oil_change") as ScheduledProgramKey)
                  }
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULED_PROGRAMS.map((entry) => (
                      <SelectItem key={entry.key} value={entry.key}>
                        {entry.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("maintenance.scopeLabel")}</span>
                <Select
                  items={SCOPES.map((entry) => ({
                    value: entry,
                    label: t(`maintenance.scope.${entry}`),
                  }))}
                  value={scope}
                  onValueChange={(next) => {
                    setScope((next ?? "vehicle_type") as MaintenanceRuleScope);
                    setTarget("");
                  }}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPES.map((entry) => (
                      <SelectItem key={entry} value={entry}>
                        {t(`maintenance.scope.${entry}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("maintenance.applyTo")}</span>
                {scope === "vehicle_type" ? (
                  <Select
                    items={[
                      { value: "car", label: t("maintenance.vehicleTypes.car") },
                      { value: "bike", label: t("maintenance.vehicleTypes.bike") },
                    ]}
                    value={vehicleType}
                    onValueChange={(next) => setVehicleType(next ?? "car")}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="car">{t("maintenance.vehicleTypes.car")}</SelectItem>
                      <SelectItem value="bike">{t("maintenance.vehicleTypes.bike")}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : scope === "make" ? (
                  <Select
                    items={makeItems}
                    value={target || null}
                    onValueChange={(next) => setTarget(next ?? "")}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {makeItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : scope === "vehicle" ? (
                  <Select
                    items={vehicleItems}
                    value={target || null}
                    onValueChange={(next) => setTarget(next ?? "")}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {vehicleItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    className="h-9"
                    value={target}
                    placeholder={t("maintenance.makeModelPlaceholder")}
                    onChange={(event) => setTarget(event.target.value)}
                  />
                )}
              </label>
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("maintenance.kmInterval")}</span>
                <Input
                  type="number"
                  min={0}
                  className="h-9 tabular-nums"
                  value={newKm}
                  onChange={(event) => setNewKm(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">{t("maintenance.dayInterval")}</span>
                <Input
                  type="number"
                  min={0}
                  className="h-9 tabular-nums"
                  value={newDays}
                  onChange={(event) => setNewDays(event.target.value)}
                />
              </label>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={saving || (scope !== "vehicle_type" && !target)}
                  onClick={() => void addRule()}
                >
                  <Plus className="me-1 h-4 w-4" />
                  {t("actions.addSchedule")}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("maintenance.zeroMeans")}</p>
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
