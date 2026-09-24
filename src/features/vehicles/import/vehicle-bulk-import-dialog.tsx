"use client";

import { useMemo, useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Download, ExternalLink, FilePlus2, History, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { SegmentOption } from "@/components/app/toggle-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query/query-keys";
import { parseSpreadsheetFile } from "@/lib/import/spreadsheet";
import {
  applyVehicleImport,
  listVehicleImportBatches,
  listVehicleImportRows,
  redoVehicleImport,
  undoVehicleImport,
} from "../vehicle-import-actions";
import type { VehicleImportField } from "./vehicle-import-columns";
import { previewVehicleImport, type VehicleImportExisting } from "./vehicle-import-preview";
import type { VehicleListRow } from "../types";
import { redoTargetId, undoTargetId } from "./vehicle-import-stack";
import {
  defaultTemplateSelection,
  downloadVehicleTemplate,
} from "./vehicle-import-sheet";
import { VehicleTemplateColumnPicker } from "./vehicle-template-picker";

const KNOWN_ERRORS = new Set([
  "missing_fields",
  "duplicate_bike_id",
  "invalid_vehicle_id",
  "invalid_plate",
  "invalid_chassis",
  "invalid_make",
  "invalid_model",
  "invalid_location",
  "invalid_year",
  "invalid_chip",
  "invalid_fuel_limit",
  "not_authorized",
  "save_failed",
  "missing_vehicle_id_column",
  "duplicate_in_file",
  "invalid_kind",
  "invalid_status",
  "invalid_condition",
  "invalid_fuel_type",
  "invalid_fuel_company",
  "invalid_car_type",
  "invalid_type_of_use",
  "empty_sheet",
  "too_many_rows",
  "nothing_to_undo",
  "nothing_to_redo",
]);

function toExisting(row: VehicleListRow): VehicleImportExisting {
  return {
    id: row.id,
    bike_id: row.bike_id,
    reg_number: row.reg_number,
    chassis_no: row.chassis_no,
    make: row.make,
    model: row.model,
    model_year: row.model_year,
    vehicle_type_key: row.vehicle_type_key,
    project_type: row.project_type,
    status: row.status,
    location_text: row.location_text,
    condition: row.condition,
    car_type: row.car_type,
    type_of_use: row.type_of_use,
    fuel_type: row.fuel_type,
    fuel_company: row.fuel_company,
    chip_no: row.chip_no,
    fuel_monthly_limit_kwd: row.fuel_monthly_limit_kwd,
  };
}

export function VehicleBulkImportDialog({
  open,
  onOpenChange,
  vehicles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicles: VehicleListRow[];
}) {
  const t = useTranslations("pages.vehicles.import");
  const te = useTranslations("pages.vehicles.errors");
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<"new" | "history">("new");
  const [logBatchId, setLogBatchId] = useState<string | null>(null);
  const [selected, setSelected] = useState(defaultTemplateSelection);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<string[][]>([]);
  const [pending, startTransition] = useTransition();

  const batches = useQuery({
    queryKey: queryKeys.vehicles.imports(),
    queryFn: () => listVehicleImportBatches(),
    enabled: open,
  });
  const log = useQuery({
    queryKey: [...queryKeys.vehicles.imports(), "rows", logBatchId],
    queryFn: () => listVehicleImportRows(logBatchId ?? ""),
    enabled: open && Boolean(logBatchId),
  });

  const tips = (batches.data ?? []).map((batch) => ({
    id: batch.id,
    status: batch.status,
    createdAt: batch.createdAt,
    undoSeq: batch.undoSeq,
    redoable: batch.redoable,
  }));
  const canUndo = Boolean(undoTargetId(tips));
  const canRedo = Boolean(redoTargetId(tips));

  const preview = useMemo(
    () =>
      headers.length
        ? previewVehicleImport({
            headers,
            rows: sheetRows,
            existing: vehicles.map(toExisting),
          })
        : { error: null, rows: [] },
    [headers, sheetRows, vehicles],
  );
  const ready = preview.rows.filter((row) => row.status !== "error").length;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.vehicles.all() });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls") && !name.endsWith(".csv")) {
      toast.error(t("badFile"));
      return;
    }
    const parsed = await parseSpreadsheetFile(file);
    setFileName(file.name);
    setHeaders(parsed.headers);
    setSheetRows(parsed.rows);
  };

  const apply = () => {
    startTransition(async () => {
      const result = await applyVehicleImport({ fileName, headers, rows: sheetRows });
      if (result.error) {
        toast.error(message(result.error));
        return;
      }
      toast.success(t("applied", { applied: result.applied ?? 0, failed: result.failed ?? 0 }));
      setHeaders([]);
      setSheetRows([]);
      setFileName("");
      await refresh();
    });
  };

  const undo = () => {
    startTransition(async () => {
      const result = await undoVehicleImport();
      if (result.error) {
        toast.error(message(result.error));
        return;
      }
      toast.success(t("undone"));
      await refresh();
    });
  };

  const redo = () => {
    startTransition(async () => {
      const result = await redoVehicleImport();
      if (result.error) {
        toast.error(message(result.error));
        return;
      }
      toast.success(t("redone"));
      await refresh();
    });
  };

  const message = (code: string) => {
    if (KNOWN_ERRORS.has(code)) return te(code);
    return code;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(92vh,880px)] w-[min(1200px,96vw)] max-w-none flex-col gap-0 overflow-visible rounded-xl p-0 sm:max-w-[min(1200px,96vw)]"
        showCloseButton
        closeOutside
      >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pt-4 pb-3">
          {logBatchId ? (
            <LogTable
              rows={log.data ?? []}
              loading={log.isLoading}
              onBack={() => setLogBatchId(null)}
            />
          ) : (
            <>
              <div className="flex gap-1" role="radiogroup">
                <SegmentOption
                  selected={panel === "new"}
                  variant="success"
                  onClick={() => setPanel("new")}
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  {t("newImport")}
                </SegmentOption>
                <SegmentOption
                  selected={panel === "history"}
                  variant="success"
                  onClick={() => setPanel("history")}
                >
                  <History className="h-3.5 w-3.5" />
                  {t("previousImports")}
                </SegmentOption>
              </div>
              {panel === "new" ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <p className="text-xs text-foreground">
                      <span className="font-semibold">{t("requiredLabel")}</span> {t("requiredCopy")}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{t("optionalCopy")}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        className="h-9 cursor-pointer bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={() => downloadVehicleTemplate(selected)}
                      >
                        <Download className="me-2 h-3.5 w-3.5" />
                        {t("downloadTemplate")}
                      </Button>
                      <VehicleTemplateColumnPicker
                        selected={selected}
                        onToggle={(field: VehicleImportField) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(field)) next.delete(field);
                            else next.add(field);
                            return next;
                          });
                        }}
                        onSelectAll={() => setSelected(defaultTemplateSelection())}
                        onRequiredOnly={() => setSelected(new Set())}
                      />
                    </div>
                  </div>
                  <label className="flex h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
                    <Upload className="mb-1 h-4 w-4" />
                    {t("drop")}
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="sr-only"
                      onChange={(event) => {
                        void onFile(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  {preview.error ? (
                    <p className="text-xs text-destructive">{message(preview.error)}</p>
                  ) : null}
                  {preview.rows.length ? (
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className={TABLE_HEAD_CLASS}>{t("colVehicleId")}</TableHead>
                            <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                            <TableHead className={TABLE_HEAD_CLASS}>{t("colMessage")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.rows.map((row) => (
                            <TableRow key={row.rowIndex}>
                              <TableCell className="text-xs">{row.bikeId}</TableCell>
                              <TableCell className="text-xs">{t(`outcome.${row.status}`)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {row.error ? message(row.error) : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}
                </div>
              ) : (
                <HistoryTable
                  rows={batches.data ?? []}
                  loading={batches.isLoading}
                  onView={setLogBatchId}
                />
              )}
            </>
          )}
        </div>
        <div className="px-5 pb-4">
          <AppModalFooter title={t("title")} subtitle={t("subtitle")}>
            {logBatchId ? (
              <Button type="button" variant="outline" className="h-9" onClick={() => setLogBatchId(null)}>
                {t("back")}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={!canUndo || pending}
                  onClick={undo}
                >
                  {t("undo")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={!canRedo || pending}
                  onClick={redo}
                >
                  {t("redo")}
                </Button>
                {panel === "new" && !logBatchId ? (
                  <Button
                    type="button"
                    className="h-9"
                    disabled={pending || ready === 0 || Boolean(preview.error)}
                    onClick={apply}
                  >
                    {pending ? <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" /> : null}
                    {t("apply")}
                  </Button>
                ) : null}
              </>
            )}
          </AppModalFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryTable({
  rows,
  loading,
  onView,
}: {
  rows: Awaited<ReturnType<typeof listVehicleImportBatches>>;
  loading: boolean;
  onView: (id: string) => void;
}) {
  const t = useTranslations("pages.vehicles.import");
  if (loading) return <p className="text-xs text-muted-foreground">{t("loading")}</p>;
  if (!rows.length) return <p className="text-xs text-muted-foreground">{t("historyEmpty")}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={TABLE_HEAD_CLASS}>{t("colFile")}</TableHead>
            <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
            <TableHead className={TABLE_HEAD_CLASS}>{t("colProgress")}</TableHead>
            <TableHead className={TABLE_HEAD_CLASS}>{t("colWhen")}</TableHead>
            <TableHead className={TABLE_HEAD_CLASS}>{t("colActions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="text-xs">{row.fileName}</TableCell>
              <TableCell className="text-xs">{t(`batch.${row.status}`)}</TableCell>
              <TableCell className="text-xs tabular-nums">
                {row.appliedRows}/{row.totalRows}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(row.createdAt).toLocaleString()}
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-8 cursor-pointer px-2 text-primary hover:bg-primary/10"
                  onClick={() => onView(row.id)}
                >
                  <ExternalLink className="me-1 h-3.5 w-3.5" />
                  {t("viewImport")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LogTable({
  rows,
  loading,
  onBack,
}: {
  rows: Awaited<ReturnType<typeof listVehicleImportRows>>;
  loading: boolean;
  onBack: () => void;
}) {
  const t = useTranslations("pages.vehicles.import");
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="h-9" onClick={onBack}>
        {t("back")}
      </Button>
      {loading ? <p className="text-xs text-muted-foreground">{t("loading")}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colVehicleId")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
              <TableHead className={TABLE_HEAD_CLASS}>{t("colMessage")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.rowIndex}>
                <TableCell className="text-xs">{row.bikeId}</TableCell>
                <TableCell className="text-xs">{t(`outcome.${row.outcome}`)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{row.message ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
