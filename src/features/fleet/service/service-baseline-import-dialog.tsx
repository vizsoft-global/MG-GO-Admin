"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { queryKeys } from "@/lib/query/query-keys";
import {
  applyServiceBaselineImport,
  type BaselineImportResult,
} from "./service-actions";
import {
  previewBaselineImport,
  type BaselineFleetVehicle,
  type BaselineImportGroup,
  type BaselineImportPreview,
} from "./service-baseline-import";
import { downloadSheet, readSheetRows } from "./service-sheet-read";
import { serviceErrorKey, useMaintenanceSchedules, useServiceVehicles } from "./use-service";

const GROUP_ORDER: BaselineImportGroup[] = ["plate", "chassis", "create", "reject"];

/**
 * **Import baseline** — the client's own car sheet.
 *
 * The preview is the important half. It prints four groups, and the one the
 * operator must see before pressing Apply is **New vehicle**: nine plates in the
 * sheet are cars the fleet does not yet hold, and they are created rather than
 * skipped. Everything is matched on plate *and* chassis first, so pressing Apply
 * twice on the same sheet creates nothing the second time.
 */
export function ServiceBaselineImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.fleetService");
  const queryClient = useQueryClient();
  const vehicles = useServiceVehicles();
  const schedules = useMaintenanceSchedules();
  const [rows, setRows] = useState<unknown[][]>([]);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<BaselineImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BaselineImportResult | null>(null);

  const fleet: BaselineFleetVehicle[] = useMemo(
    () =>
      (vehicles.data ?? []).map((vehicle) => ({
        id: vehicle.id,
        plate: vehicle.plate,
        chassisNo: vehicle.chassis_no,
        make: vehicle.make,
        model: vehicle.model,
        vehicleTypeKey: vehicle.vehicle_type_key,
        condition: vehicle.condition,
        zoneName: vehicle.zone_name,
        driverName: vehicle.driver_name,
        currentKm: vehicle.current_odometer_km,
      })),
    [vehicles.data],
  );

  function reset() {
    setRows([]);
    setFileName("");
    setPreview(null);
    setResult(null);
  }

  async function readFile(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const parsed = await readSheetRows(file);
      setRows(parsed);
      setFileName(file.name);
      setPreview(previewBaselineImport(parsed, fleet, schedules.data ?? []));
    } catch {
      toast.error(t("import.parseFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (rows.length === 0) return;
    setBusy(true);
    const applied = await applyServiceBaselineImport({ rows });
    setBusy(false);
    if ("error" in applied) {
      toast.error(t(serviceErrorKey(applied.error)));
      return;
    }
    setResult(applied);
    toast.success(
      t("import.baselineApplied", {
        created: applied.created,
        matched: applied.matchedByPlate + applied.matchedByChassis,
      }),
    );
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
  }

  const groupLabel: Record<BaselineImportGroup, string> = {
    plate: t("import.groupPlate"),
    chassis: t("import.groupChassis"),
    create: t("import.groupCreate"),
    reject: t("import.groupReject"),
  };

  /**
   * The preview carries machine-readable notes (they are what the apply step and
   * the tests assert on); the table must print words. Each prefix maps to one
   * catalogue key, and a suffix the operator needs — which row, which plate, which
   * figure — is appended as-is because it is data, not copy.
   */
  function noteLabel(note: string): string {
    if (note === "missing_plate") return t("import.notes.missing_plate");
    const duplicatePlate = /^duplicate_plate_of_row_(\d+)$/.exec(note);
    if (duplicatePlate) return `${t("import.notes.duplicate_plate")} (${duplicatePlate[1]})`;
    const duplicateChassis = /^duplicate_chassis_of_row_(\d+)$/.exec(note);
    if (duplicateChassis) return `${t("import.notes.duplicate_chassis")} (${duplicateChassis[1]})`;
    const inFleet = /^plate_in_fleet_is_(.+)$/.exec(note);
    if (inFleet) return `${t("import.notes.plate_in_fleet")}: ${inFleet[1]}`;
    const expected = /^next_km_expected_(\d+)$/.exec(note);
    if (expected) return `${t("import.notes.next_km_expected")}: ${expected[1]}`;
    const below = /^current_km_below_last_service_(\d+)_lt_(\d+)$/.exec(note);
    if (below) return `${t("import.notes.current_km_below_last_service")}: ${below[1]} < ${below[2]}`;
    return note;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton closeOutside className="w-[min(880px,96vw)]">
        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 pt-4 pb-2">
          <p className="text-sm text-muted-foreground">{t("import.baselineHint")}</p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="h-9 text-sm file:me-2 file:h-9 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:text-sm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() =>
                downloadSheet(
                  "dpd-service-baseline-import.xlsx",
                  "Service baseline",
                  ["Plate number", "Chassis Number", "Model", "Current KM", "last service", "last service Date", "Next Km"],
                  [["23/21208", "MR0AB8CD800123456", "Toyota/Yaris", 74721, 70000, "18/10/2026", 80000]],
                )
              }
            >
              {t("import.downloadTemplate")}
            </Button>
            {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
          </div>

          {preview ? (
            <div className="space-y-2">
              <div className="grid gap-2 sm:grid-cols-4">
                {GROUP_ORDER.map((group) => (
                  <div key={group} className="rounded-lg border border-border p-2 text-xs">
                    <div className="text-muted-foreground">{groupLabel[group]}</div>
                    <div className="text-lg font-semibold tabular-nums">{preview.counts[group]}</div>
                  </div>
                ))}
              </div>
              {preview.kmBelowService > 0 ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  {t("import.kmBelowService", { count: preview.kmBelowService })}
                </p>
              ) : null}
              {preview.nextKmMismatches > 0 ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {t("import.nextKmMismatch", { count: preview.nextKmMismatches })}
                </p>
              ) : null}
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-start">{t("import.colRow")}</th>
                      <th className="px-2 py-1 text-start">{t("maintenance.cols.plate")}</th>
                      <th className="px-2 py-1 text-start">{t("import.colModel")}</th>
                      <th className="px-2 py-1 text-start">{t("import.colGroup")}</th>
                      <th className="px-2 py-1 text-start">{t("import.colNote")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.slice(0, 200).map((item) => (
                      <tr key={item.sheetRow} className="border-t border-border">
                        <td className="px-2 py-1 tabular-nums">{item.sheetRow}</td>
                        <td className="px-2 py-1 font-medium tabular-nums">{item.plate || "—"}</td>
                        <td className="px-2 py-1">{item.modelRaw ?? "—"}</td>
                        <td className="px-2 py-1">
                          <Badge
                            variant="outline"
                            className={
                              item.group === "create"
                                ? "border-sky-200 bg-sky-50 text-sky-800"
                                : item.group === "reject"
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
                            }
                          >
                            {groupLabel[item.group]}
                          </Badge>
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {item.notes.map(noteLabel).join(", ") || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {result && "ok" in result ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {t("import.baselineResult", {
                plate: result.matchedByPlate,
                chassis: result.matchedByChassis,
                created: result.created,
                rejected: result.rejected,
                records: result.records,
              })}
            </p>
          ) : null}
        </div>
        <AppModalFooter title={t("actions.importBaseline")}>
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("actions.close")}
          </Button>
          <Button
            type="button"
            className="h-9"
            disabled={busy || !preview || preview.items.length === 0}
            onClick={() => void apply()}
          >
            {t("import.apply")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
