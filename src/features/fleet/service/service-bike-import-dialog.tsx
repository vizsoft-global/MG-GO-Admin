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
import { kuwaitTodayYmd } from "@/lib/date/kuwait-dates";
import { applyBikeServiceImport } from "./service-actions";
import {
  BIKE_IMPORT_HEADERS,
  previewBikeImport,
  type BikeFleetVehicle,
  type BikeImportPreview,
} from "./service-bike-import";
import { downloadSheet, readSheetRows } from "./service-sheet-read";
import { serviceErrorKey, useServiceVehicles } from "./use-service";

/**
 * **Import bike service records.**
 *
 * The client's end state is a read of Bajaj Care. There is no API contract in
 * this repo, so this sheet is how bikes get history today — and it is
 * deliberately strict: a car plate is rejected (`not_a_bike`), an unrecognised
 * service type is rejected rather than filed as `other`, and a future date is
 * refused. A bike's oil date moves only on a bike's real service.
 */
export function ServiceBikeImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.fleetService");
  const queryClient = useQueryClient();
  const vehicles = useServiceVehicles();
  const [rows, setRows] = useState<unknown[][]>([]);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<BikeImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ created: number; rejected: number } | null>(null);

  const fleet: BikeFleetVehicle[] = useMemo(
    () =>
      (vehicles.data ?? []).map((vehicle) => ({
        id: vehicle.id,
        plate: vehicle.plate,
        chassisNo: vehicle.chassis_no,
        vehicleTypeKey: vehicle.vehicle_type_key,
      })),
    [vehicles.data],
  );

  async function readFile(file: File) {
    setBusy(true);
    setDone(null);
    try {
      const parsed = await readSheetRows(file);
      setRows(parsed);
      setFileName(file.name);
      setPreview(previewBikeImport(parsed, fleet, kuwaitTodayYmd()));
    } catch {
      toast.error(t("import.parseFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (rows.length === 0) return;
    setBusy(true);
    const applied = await applyBikeServiceImport({ rows });
    setBusy(false);
    if ("error" in applied) {
      toast.error(t(serviceErrorKey(applied.error)));
      return;
    }
    setDone(applied);
    toast.success(t("import.bikeApplied", { created: applied.created }));
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.all() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setRows([]);
          setFileName("");
          setPreview(null);
          setDone(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton closeOutside className="w-[min(820px,96vw)]">
        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 pt-4 pb-2">
          <p className="text-sm text-muted-foreground">{t("bikes.importHint")}</p>
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
                  "dpd-bike-service-import.xlsx",
                  "Bike service",
                  BIKE_IMPORT_HEADERS,
                  [
                    [
                      "B-1042",
                      "18/10/2026",
                      "Oil change",
                      18420,
                      8.5,
                      "Bajaj Care",
                      "INV-7781",
                      "10W-40",
                    ],
                  ],
                )
              }
            >
              {t("import.downloadTemplate")}
            </Button>
            {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
          </div>

          {preview ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-emerald-50 text-emerald-700"
                >
                  {t("import.toCreate")}: {preview.counts.create}
                </Badge>
                <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
                  {t("import.groupReject")}: {preview.counts.reject}
                </Badge>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-start">{t("import.colRow")}</th>
                      <th className="px-2 py-1 text-start">{t("maintenance.cols.plate")}</th>
                      <th className="px-2 py-1 text-start">{t("cols.date")}</th>
                      <th className="px-2 py-1 text-start">{t("cols.type")}</th>
                      <th className="px-2 py-1 text-start">{t("cols.odometer")}</th>
                      <th className="px-2 py-1 text-start">{t("import.colNote")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.slice(0, 200).map((item) => (
                      <tr key={item.sheetRow} className="border-t border-border">
                        <td className="px-2 py-1 tabular-nums">{item.sheetRow}</td>
                        <td className="px-2 py-1 font-medium tabular-nums">{item.plate || "—"}</td>
                        <td className="px-2 py-1 tabular-nums">{item.serviceDay ?? "—"}</td>
                        <td className="px-2 py-1">{item.programKey ?? item.serviceTypeRaw ?? "—"}</td>
                        <td className="px-2 py-1 tabular-nums">{item.odometerKm ?? "—"}</td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {item.problem ? t(`import.problems.${item.problem}`) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {done ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {t("import.bikeResult", { created: done.created, rejected: done.rejected })}
            </p>
          ) : null}
        </div>
        <AppModalFooter title={t("bikes.importTitle")}>
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => onOpenChange(false)}
          >
            {t("actions.close")}
          </Button>
          <Button
            type="button"
            className="h-9"
            disabled={busy || !preview || preview.counts.create === 0}
            onClick={() => void apply()}
          >
            {t("import.apply")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
