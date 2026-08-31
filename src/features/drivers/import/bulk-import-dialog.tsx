"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Building2, Download, Loader2, MapPin, Store, Upload } from "lucide-react";
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
import { fetchDriverImportLookups } from "../drivers-import-actions";
import {
  useApplyDriverImportBatch,
  useResolveDriverImportPreview,
  type DriverImportPreviewRow,
} from "../use-drivers";
import type { DriverImportCredential, DriverImportTargetField } from "../types";
import { DRIVER_IMPORT_REQUIRED_FIELDS } from "../types";
import { DriverMappingBoard } from "./mapping-board";
import {
  guessColumnMapping,
  loadStoredMapping,
  mapRowsFromSheet,
  saveStoredMapping,
} from "./parse";
import {
  DRIVER_IMPORT_TEMPLATE_PATH,
  TEMPLATE_COLUMNS_PARAM,
  resolveTemplateColumns,
} from "./template";
import { TemplateColumnPicker } from "./template-column-picker";
import {
  buildCredentialsAoa,
  buildImportErrorAoa,
  downloadAoaXlsx,
  downloadWorkbookXlsx,
} from "./export-xlsx";
import {
  partnersLookupAoa,
  restaurantsLookupAoa,
  zonesLookupAoa,
} from "./lookups";
import { useCustomFieldDefinitions } from "@/features/custom-fields/use-custom-fields";

type Step = "upload" | "map" | "preview" | "result";

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

const SPREADSHEET_ACCEPT = ".csv,.xlsx,.xls";

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
  const [dragActive, setDragActive] = useState(false);
  const [result, setResult] = useState<{
    applied: number;
    skipped: number;
    approved: number;
    failures: Array<{ rowIndex: number; reason: string }>;
    credentials: DriverImportCredential[];
  } | null>(null);

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

  const templateCustomColumns = useMemo(
    () =>
      customFieldDefs
        .filter((d) => d.is_active && !d.archived_at)
        .map((d) => ({
          key: d.key,
          label: d.label,
          field_type: d.field_type,
          options: d.options ?? [],
        })),
    [customFieldDefs],
  );
  const templateColumns = useMemo(
    () => resolveTemplateColumns(null, templateCustomColumns),
    [templateCustomColumns],
  );
  // Null until the operator opens the picker, which keeps the download URL bare
  // and the generated file identical to the un-customised template.
  const [templateSelection, setTemplateSelection] = useState<Set<string> | null>(
    null,
  );
  const templateSelected = useMemo(
    () =>
      templateSelection ??
      new Set(templateColumns.map((column) => column.field)),
    [templateSelection, templateColumns],
  );
  const templateHref = useMemo(() => {
    if (!templateSelection) return DRIVER_IMPORT_TEMPLATE_PATH;
    const cols = templateColumns
      .filter((column) => column.pinned || templateSelected.has(column.field))
      .map((column) => column.field);
    return `${DRIVER_IMPORT_TEMPLATE_PATH}?${TEMPLATE_COLUMNS_PARAM}=${encodeURIComponent(cols.join(","))}`;
  }, [templateSelection, templateSelected, templateColumns]);

  const summary = useMemo(() => {
    const ready = preview.filter((r) => r.status === "ok" && !r.skip).length;
    const duplicate = preview.filter((r) =>
      ["duplicate_phone", "duplicate_civil_id", "duplicate_employee_id"].includes(r.status),
    ).length;
    const invalid = preview.filter((r) => r.status !== "ok").length - duplicate;
    return { ready, duplicate, invalid, total: preview.length };
  }, [preview]);

  const errorRowCount = useMemo(() => {
    if (!result) return preview.filter((r) => r.status !== "ok").length;
    const failedIndexes = new Set(result.failures.map((f) => f.rowIndex));
    return preview.filter((r) => r.status !== "ok" || failedIndexes.has(r.rowIndex)).length;
  }, [preview, result]);

  const reset = useCallback(() => {
    setStep("upload");
    setFileName("");
    setHeaders([]);
    setRows([]);
    setHeaderSignature("");
    setMapping({});
    setPreview([]);
    setApproveImmediately(false);
    setResult(null);
    setDragActive(false);
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
    setResult(null);
    setStep("map");
  };

  const goPreview = () => {
    if (!headers.length) return;
    const missingRequired = DRIVER_IMPORT_REQUIRED_FIELDS.filter((field) => !mapping[field]);
    if (missingRequired.length > 0) {
      toast.error(t("mappingRequired"));
      return;
    }
    if (!mapping.zone_id && !mapping.restaurant_ids) {
      toast.error(t("assignmentMappingRequired"));
      return;
    }
    saveStoredMapping(headerSignature, mapping);
    const mapped = mapRowsFromSheet(headers, rows, mapping, customFieldKeys);
    startTransition(async () => {
      try {
        const previewResult = await resolvePreview.mutateAsync(mapped);
        if (previewResult && typeof previewResult === "object" && "error" in previewResult) {
          toast.error(t("previewFailed"));
          return;
        }
        setPreview(previewResult);
        setStep("preview");
      } catch {
        toast.error(t("previewFailed"));
      }
    });
  };

  const handleImport = () => {
    startTransition(async () => {
      const applyResult = await applyBatch.mutateAsync({
        fileName,
        mapping: mapping as Record<string, string>,
        rows: preview,
        duplicateStrategy,
        approveImmediately,
      });
      if ("error" in applyResult) {
        toast.error(t("importFailed"));
        return;
      }
      setResult({
        applied: applyResult.applied,
        skipped: applyResult.skipped,
        approved: applyResult.approved,
        failures: applyResult.failures,
        credentials: applyResult.credentials,
      });
      setStep("result");
      const failureSample = applyResult.failures
        .slice(0, 3)
        .map((f) => `Row ${f.rowIndex + 1}: ${f.reason}`)
        .join("\n");
      if (applyResult.applied === 0 && applyResult.failures.length > 0) {
        toast.error(t("importFailed"), {
          description: failureSample,
          duration: 12_000,
        });
        return;
      }
      toast.success(
        t("importSuccess", {
          applied: applyResult.applied,
          skipped: applyResult.skipped,
          approved: applyResult.approved,
        }),
        failureSample
          ? { description: failureSample, duration: 10_000 }
          : undefined,
      );
    });
  };

  const downloadErrors = () => {
    const aoa = buildImportErrorAoa(headers, rows, preview, result?.failures ?? []);
    if (aoa.length <= 1) return;
    downloadAoaXlsx("driver-import-errors.xlsx", "Errors", aoa);
  };

  const downloadCredentials = () => {
    if (!result?.credentials.length) return;
    downloadAoaXlsx(
      "driver-import-credentials.xlsx",
      "Credentials",
      buildCredentialsAoa(result.credentials, customFields),
    );
  };

  const downloadLookups = (kind: "all" | "restaurants" | "zones" | "partners") => {
    startTransition(async () => {
      const data = await fetchDriverImportLookups();
      if ("error" in data) {
        toast.error(t("lookupFailed"));
        return;
      }
      if (kind === "restaurants") {
        downloadAoaXlsx(
          "driver-import-restaurants.xlsx",
          "Restaurants",
          restaurantsLookupAoa(data.restaurants),
        );
        return;
      }
      if (kind === "zones") {
        downloadAoaXlsx("driver-import-zones.xlsx", "Zones", zonesLookupAoa(data.zones));
        return;
      }
      if (kind === "partners") {
        downloadAoaXlsx(
          "driver-import-partners.xlsx",
          "Partners",
          partnersLookupAoa(data.partners),
        );
        return;
      }
      downloadWorkbookXlsx("driver-import-assignment-ids.xlsx", [
        { name: "Restaurants", aoa: restaurantsLookupAoa(data.restaurants) },
        { name: "Zones", aoa: zonesLookupAoa(data.zones) },
        { name: "Partners", aoa: partnersLookupAoa(data.partners) },
      ]);
    });
  };

  const requiredMapped =
    DRIVER_IMPORT_REQUIRED_FIELDS.every((field) => mapping[field]) &&
    Boolean(mapping.zone_id || mapping.restaurant_ids);

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
              <div className="space-y-1.5 rounded-lg border border-border px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("requiredTitle")} <span className="text-destructive">*</span>
                </p>
                <p className="text-xs text-foreground">{t("requiredList")}</p>
                <p className="text-[10px] text-muted-foreground">{t("optionalList")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-9 cursor-pointer rounded-lg"
                  nativeButton={false}
                  render={
                    <a
                      href={templateHref}
                      download="dpd-driver-import-template.xlsx"
                    />
                  }
                >
                  <Download className="me-2 h-4 w-4" />
                  {t("downloadSample")}
                </Button>
                <TemplateColumnPicker
                  columns={templateColumns}
                  selected={templateSelected}
                  onToggle={(field) =>
                    setTemplateSelection((prev) => {
                      const base =
                        prev ?? new Set(templateColumns.map((c) => c.field));
                      const next = new Set(base);
                      if (next.has(field)) next.delete(field);
                      else next.add(field);
                      return next;
                    })
                  }
                  onSelectAll={() =>
                    setTemplateSelection(
                      new Set(templateColumns.map((c) => c.field)),
                    )
                  }
                  onRequiredOnly={() => setTemplateSelection(new Set())}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 cursor-pointer rounded-lg"
                  disabled={isPending}
                  onClick={() => downloadLookups("all")}
                >
                  {isPending ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="me-2 h-4 w-4" />
                  )}
                  {t("downloadLookups")}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">{t("templateHint")}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("lookupLists")}
              </p>
              <p className="text-[10px] text-muted-foreground">{t("lookupHint")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 cursor-pointer rounded-lg"
                  disabled={isPending}
                  onClick={() => downloadLookups("restaurants")}
                >
                  <Store className="me-2 h-4 w-4" />
                  {t("downloadRestaurants")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 cursor-pointer rounded-lg"
                  disabled={isPending}
                  onClick={() => downloadLookups("zones")}
                >
                  <MapPin className="me-2 h-4 w-4" />
                  {t("downloadZones")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 cursor-pointer rounded-lg"
                  disabled={isPending}
                  onClick={() => downloadLookups("partners")}
                >
                  <Building2 className="me-2 h-4 w-4" />
                  {t("downloadPartners")}
                </Button>
              </div>
              <label
                className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-6 py-5 ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/20 hover:bg-muted/40"
                }`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleFile(f);
                }}
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">{t("dropHint")}</span>
                <span className="text-xs text-muted-foreground">{t("formats")}</span>
                <input
                  type="file"
                  accept={SPREADSHEET_ACCEPT}
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
            <>
              {!requiredMapped ? (
                <p className="text-xs text-destructive">{t("mappingRequired")}</p>
              ) : null}
              <DriverMappingBoard
                headers={headers}
                sampleRow={rows[0] ?? []}
                mapping={mapping}
                onMappingChange={setMapping}
                customFields={customFields}
              />
            </>
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
                  <SelectTrigger className="h-9 w-48 cursor-pointer rounded-lg">
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
                <div>
                  <Label htmlFor="approve-immediately" className="text-sm">
                    {t("approveImmediately")}
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    {t("approveImmediatelyHint")}
                  </p>
                </div>
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
                      <th className="px-2 py-1.5">{t("colActive")}</th>
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
                        {/* Resolved the same way `applyDriverImportBatch` does,
                            so the operator sees the answer before importing
                            rather than reading it off the result summary. */}
                        <td className="px-2 py-1">
                          {(row.active ?? approveImmediately)
                            ? t("activeYes")
                            : t("activeNo")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {step === "result" && result ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("importSuccess", {
                  applied: result.applied,
                  skipped: result.skipped,
                  approved: result.approved,
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 cursor-pointer rounded-md"
                  disabled={errorRowCount === 0}
                  onClick={downloadErrors}
                >
                  <Download className="me-2 h-4 w-4" />
                  {t("downloadErrors", { count: errorRowCount })}
                </Button>
                {result.credentials.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 cursor-pointer rounded-md"
                    onClick={downloadCredentials}
                  >
                    <Download className="me-2 h-4 w-4" />
                    {t("downloadCredentials", { count: result.credentials.length })}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        {step !== "upload" ? (
          <AppModalFooter
            title={t("title")}
            subtitle={
              step === "map"
                ? requiredMapped
                  ? t("dropHint")
                  : t("mappingRequired")
                : step === "result" && result
                  ? t("importSuccess", {
                      applied: result.applied,
                      skipped: result.skipped,
                      approved: result.approved,
                    })
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
                  disabled={isPending || !requiredMapped}
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
            {step === "result" ? (
              <Button
                type="button"
                size="sm"
                className="h-9 cursor-pointer rounded-md px-4"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                {t("done")}
              </Button>
            ) : null}
          </AppModalFooter>
        ) : (
          <AppModalFooter title={t("title")} subtitle={t("formats")} />
        )}
      </DialogContent>
    </Dialog>
  );
}
