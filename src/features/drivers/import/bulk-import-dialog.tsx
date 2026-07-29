"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/dashboard/status-pill";
import { parseSpreadsheetFile } from "@/lib/import/spreadsheet";
import {
  useApplyDriverImportBatch,
  useResolveDriverImportPreview,
  type DriverImportPreviewRow,
} from "../use-drivers";
import { DriverMappingBoard } from "./mapping-board";
import {
  guessColumnMapping,
  loadStoredMapping,
  mapRowsFromSheet,
  saveStoredMapping,
} from "./parse";
import { DRIVER_IMPORT_TEMPLATE_PATH } from "./template";
import type { DriverImportTargetField } from "../types";
import { useCustomFieldDefinitions } from "@/features/custom-fields/use-custom-fields";

type Step = "upload" | "map" | "preview";

function previewVariant(
  status: DriverImportPreviewRow["status"],
): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "ok":
      return "success";
    case "duplicate_phone":
    case "duplicate_civil_id":
    case "duplicate_employee_id":
      return "warning";
    default:
      return "danger";
  }
}

export function DriverBulkImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.drivers.import");
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [headerSignature, setHeaderSignature] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<DriverImportTargetField, string>>>({});
  const [preview, setPreview] = useState<DriverImportPreviewRow[]>([]);
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "update">("skip");
  const [approveImmediately, setApproveImmediately] = useState(false);
  const [isPending, startTransition] = useTransition();

  const resolvePreview = useResolveDriverImportPreview();
  const applyBatch = useApplyDriverImportBatch();
  const { data: customFieldDefs = [] } = useCustomFieldDefinitions();
  const customFields = useMemo(
    () =>
      customFieldDefs
        .filter((d) => d.is_active && !d.archived_at)
        .map((d) => ({ key: d.key, label: d.label })),
    [customFieldDefs],
  );
  const customFieldKeys = useMemo(() => customFields.map((c) => c.key), [customFields]);

  const summary = useMemo(() => {
    const ready = preview.filter((r) => r.status === "ok" && !r.skip).length;
    const duplicate = preview.filter((r) =>
      ["duplicate_phone", "duplicate_civil_id", "duplicate_employee_id"].includes(r.status),
    ).length;
    const invalid = preview.filter((r) => r.status !== "ok").length - duplicate;
    return { ready, duplicate, invalid, total: preview.length };
  }, [preview]);

  const reset = useCallback(() => {
    setStep("upload");
    setFileName("");
    setHeaders([]);
    setRows([]);
    setHeaderSignature("");
    setMapping({});
    setPreview([]);
    setApproveImmediately(false);
  }, []);

  const handleFile = async (file: File) => {
    const parsed = await parseSpreadsheetFile(file);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setHeaderSignature(parsed.headerSignature);
    setFileName(file.name);
    const stored = loadStoredMapping(parsed.headerSignature);
    const guessed = guessColumnMapping(parsed.headers, customFieldKeys);
    setMapping({ ...guessed, ...stored });
    setStep("map");
  };

  const goPreview = () => {
    if (!headers.length) return;
    saveStoredMapping(headerSignature, mapping);
    const mapped = mapRowsFromSheet(headers, rows, mapping, customFieldKeys);
    startTransition(async () => {
      try {
        const result = await resolvePreview.mutateAsync(mapped);
        if (result && typeof result === "object" && "error" in result) {
          toast.error(t("previewFailed"));
          return;
        }
        setPreview(result);
        setStep("preview");
      } catch {
        toast.error(t("previewFailed"));
      }
    });
  };

  const handleImport = () => {
    startTransition(async () => {
      const result = await applyBatch.mutateAsync({
        fileName,
        mapping: mapping as Record<string, string>,
        rows: preview,
        duplicateStrategy,
        approveImmediately,
      });
      if ("error" in result) {
        toast.error(t("importFailed"));
        return;
      }
      const failureSample = result.failures
        .slice(0, 3)
        .map((f) => `Row ${f.rowIndex + 1}: ${f.reason}`)
        .join("\n");
      if (result.applied === 0 && result.failures.length > 0) {
        toast.error(t("importFailed"), {
          description: failureSample,
          duration: 12_000,
        });
        return;
      }
      toast.success(
        t("importSuccess", {
          applied: result.applied,
          skipped: result.skipped,
          approved: result.approved,
        }),
        failureSample
          ? { description: failureSample, duration: 10_000 }
          : undefined,
      );
      reset();
      onOpenChange(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="flex max-h-[min(92vh,880px)] flex-col gap-0 overflow-visible rounded-xl p-0 sm:max-w-3xl"
        showCloseButton
        closeOutside
      >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pt-4 pb-3">
          {step === "upload" ? (
            <>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="cursor-pointer rounded-lg"
                  nativeButton={false}
                  render={
                    <a
                      href={DRIVER_IMPORT_TEMPLATE_PATH}
                      download="dpd-driver-import-template.xlsx"
                    />
                  }
                >
                  <Download className="me-2 h-4 w-4" />
                  {t("downloadSample")}
                </Button>
              </div>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-12 hover:bg-muted/40">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">{t("dropHint")}</span>
                <span className="text-xs text-muted-foreground">{t("formats")}</span>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
              </label>
            </>
          ) : null}

          {step === "map" && headers.length > 0 ? (
            <DriverMappingBoard
              headers={headers}
              sampleRow={rows[0] ?? []}
              mapping={mapping}
              onMappingChange={setMapping}
              customFields={customFields}
            />
          ) : null}

          {step === "preview" ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("previewSummary", {
                  ready: summary.ready,
                  duplicate: summary.duplicate,
                  invalid: summary.invalid,
                })}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Label className="text-sm">{t("duplicateStrategy")}</Label>
                <Select
                  items={[
                    { value: "skip", label: t("duplicateSkip") },
                    { value: "update", label: t("duplicateUpdate") },
                  ]}
                  value={duplicateStrategy}
                  onValueChange={(v) => {
                    if (v === "skip" || v === "update") setDuplicateStrategy(v);
                  }}
                >
                  <SelectTrigger className="h-8 w-48 cursor-pointer rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip" label={t("duplicateSkip")}>
                      {t("duplicateSkip")}
                    </SelectItem>
                    <SelectItem value="update" label={t("duplicateUpdate")}>
                      {t("duplicateUpdate")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <Label htmlFor="approve-immediately" className="text-sm">
                  {t("approveImmediately")}
                </Label>
                <Switch
                  id="approve-immediately"
                  checked={approveImmediately}
                  onCheckedChange={setApproveImmediately}
                />
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted/80">
                    <tr>
                      <th className="px-2 py-1.5">{t("colStatus")}</th>
                      <th className="px-2 py-1.5">{t("colName")}</th>
                      <th className="px-2 py-1.5">{t("colPhone")}</th>
                      <th className="px-2 py-1.5">{t("colEmployeeId")}</th>
                      <th className="px-2 py-1.5">{t("colRestaurants")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 200).map((row) => (
                      <tr key={row.rowIndex} className="border-t border-border/60">
                        <td className="px-2 py-1">
                          <StatusPill variant={previewVariant(row.status)} dot={false}>
                            {t(`status.${row.status}`)}
                          </StatusPill>
                        </td>
                        <td className="px-2 py-1">{row.full_name ?? "—"}</td>
                        <td className="px-2 py-1">{row.phone ?? "—"}</td>
                        <td className="px-2 py-1 tabular-nums">{row.employee_id ?? "—"}</td>
                        <td className="px-2 py-1">
                          {row.restaurant_names.length > 0
                            ? row.restaurant_names.join(", ")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
        {step !== "upload" ? (
          <AppModalFooter
            title={t("title")}
            subtitle={
              step === "map"
                ? t("dropHint")
                : t("previewSummary", {
                    ready: summary.ready,
                    duplicate: summary.duplicate,
                    invalid: summary.invalid,
                  })
            }
          >
            {step === "map" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 cursor-pointer rounded-md"
                  onClick={() => setStep("upload")}
                >
                  {t("back")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 cursor-pointer rounded-md px-4"
                  disabled={isPending}
                  onClick={goPreview}
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("preview")
                  )}
                </Button>
              </>
            ) : null}
            {step === "preview" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 cursor-pointer rounded-md"
                  onClick={() => setStep("map")}
                >
                  {t("back")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 cursor-pointer rounded-md px-4"
                  disabled={isPending || summary.ready === 0}
                  onClick={handleImport}
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("import", { count: summary.ready })
                  )}
                </Button>
              </>
            ) : null}
          </AppModalFooter>
        ) : (
          <AppModalFooter title={t("title")} subtitle={t("formats")} />
        )}
      </DialogContent>
    </Dialog>
  );
}
