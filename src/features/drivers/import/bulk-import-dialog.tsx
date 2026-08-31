"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Building2,
  Download,
  FilePlus2,
  History,
  Loader2,
  MapPin,
  Pause,
  Play,
  Store,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "@/components/dashboard/status-pill";
import { SegmentOption } from "@/components/app/toggle-chip";
import { queryKeys } from "@/lib/query/query-keys";
import { isImportRowReady } from "./import-identity";
import { parseSpreadsheetFile } from "@/lib/import/spreadsheet";
import { fetchDriverImportLookups } from "../drivers-import-actions";
import { getDriverImportJob } from "../drivers-import-job-actions";
import { useDriverImportJob } from "./driver-import-job-provider";
import { ImportJobHistory } from "./import-job-history";
import {
  canCancelImportJob,
  canPauseImportJob,
  canResumeImportJob,
  importJobProgress,
  isActiveImportJob,
} from "./import-job";
import {
  useResolveDriverImportPreview,
  type DriverImportPreviewRow,
} from "../use-drivers";
import { importProgressLabel } from "./import-progress";
import { ImportLogPanel } from "./import-log-panel";
import type { DriverImportTargetField } from "../types";
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

type Step = "upload" | "map" | "preview" | "job";

function previewVariant(
  row: DriverImportPreviewRow,
  strategy: "skip" | "update",
): "success" | "warning" | "danger" | "neutral" {
  if (isImportRowReady(row, strategy)) return "success";
  switch (row.status) {
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
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "update">("update");
  const [approveImmediately, setApproveImmediately] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [dragActive, setDragActive] = useState(false);
  const [panel, setPanel] = useState<"new" | "previous">("new");
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);

  const { activeJob, start, pause, resume, cancel } = useDriverImportJob();
  const viewedJobQuery = useQuery({
    queryKey: queryKeys.drivers.importJob(viewingJobId ?? "none"),
    queryFn: async () => {
      const loaded = await getDriverImportJob(viewingJobId!);
      if ("error" in loaded) throw new Error(loaded.error);
      return loaded.job;
    },
    enabled: Boolean(viewingJobId),
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 2_000 : false,
  });
  const viewedJob = viewedJobQuery.data ?? null;
  const liveJob =
    viewedJob ??
    (activeJob && viewingJobId === activeJob.id ? activeJob : null);
  const jobProgress = liveJob
    ? importJobProgress(liveJob.readyCount, liveJob.remainingCount)
    : { done: 0, total: 0 };
  const importing = liveJob?.status === "running";
  const resolvePreview = useResolveDriverImportPreview();
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
    const ready = preview.filter((r) => isImportRowReady(r, duplicateStrategy)).length;
    const duplicate = preview.filter(
      (r) => r.existingByEmployeeId && r.status === "duplicate_employee_id",
    ).length;
    const invalid = preview.filter(
      (r) =>
        !isImportRowReady(r, duplicateStrategy) &&
        !(r.existingByEmployeeId && r.status === "duplicate_employee_id"),
    ).length;
    return { ready, duplicate, invalid, total: preview.length };
  }, [preview, duplicateStrategy]);

  const reset = useCallback(() => {
    setStep("upload");
    setFileName("");
    setHeaders([]);
    setRows([]);
    setHeaderSignature("");
    setMapping({});
    setPreview([]);
    setApproveImmediately(false);
    setDragActive(false);
    setPanel("new");
    setViewingJobId(null);
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

  useEffect(() => {
    if (!open || !activeJob) return;
    setViewingJobId(activeJob.id);
    setStep("job");
  }, [open, activeJob]);

  const hideDialog = () => {
    onOpenChange(false);
    if (!isActiveImportJob(liveJob?.status ?? activeJob?.status ?? "previewed")) {
      reset();
    }
  };

  const handleImport = () => {
    const ready = preview.filter((row) => isImportRowReady(row, duplicateStrategy));
    if (ready.length === 0) return;
    void (async () => {
      const job = await start({
        fileName,
        mapping: mapping as Record<string, string>,
        rows: ready,
        duplicateStrategy,
        approveImmediately,
      });
      if (!job) return;
      setViewingJobId(job.id);
      setStep("job");
      toast.success(t("startedInBackground"));
    })();
  };

  const downloadErrors = () => {
    const jobFailures = viewedJob?.failures ?? [];
    const aoa = buildImportErrorAoa(headers, rows, preview, jobFailures);
    if (aoa.length <= 1) return;
    downloadAoaXlsx("driver-import-errors.xlsx", "Errors", aoa);
  };

  const downloadCredentials = () => {
    const credentials = viewedJob?.credentials ?? [];
    if (!credentials.length) return;
    downloadAoaXlsx(
      "driver-import-credentials.xlsx",
      "Credentials",
      buildCredentialsAoa(credentials, customFields),
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
        if (!v) {
          hideDialog();
          return;
        }
        onOpenChange(true);
      }}
    >
      <DialogContent
        className="flex max-h-[min(92vh,880px)] w-[min(1200px,96vw)] flex-col gap-0 overflow-visible rounded-xl p-0 sm:max-w-[min(1200px,96vw)]"
        showCloseButton
        closeOutside
      >
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pt-4 pb-3">
          {step === "upload" ? (
            <>
              <div className="flex gap-1" role="radiogroup" aria-label={t("importMode")}>
                <SegmentOption
                  selected={panel === "new"}
                  onClick={() => setPanel("new")}
                  variant="success"
                >
                  <FilePlus2 className={panel === "new" ? "h-3.5 w-3.5" : "h-3.5 w-3.5 opacity-60"} />
                  <span className="px-2">{t("newImport")}</span>
                </SegmentOption>
                <SegmentOption
                  selected={panel === "previous"}
                  onClick={() => setPanel("previous")}
                >
                  <History className={panel === "previous" ? "h-3.5 w-3.5" : "h-3.5 w-3.5 opacity-60"} />
                  <span className="px-2">{t("previousImports")}</span>
                </SegmentOption>
              </div>
              {panel === "previous" ? (
                <ImportJobHistory
                  onView={(jobId) => {
                    setViewingJobId(jobId);
                    setStep("job");
                  }}
                />
              ) : null}
              {panel === "new" ? (
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
            </>
          ) : null}

          {step === "job" && !liveJob ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}

          {step === "job" && liveJob ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("jobDetailSummary", {
                  file: liveJob.fileName,
                  status: t(`jobStatus.${liveJob.status}`),
                })}
              </p>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-emerald-500 transition-[width] duration-200"
                  style={{
                    width: `${
                      jobProgress.total === 0
                        ? 0
                        : Math.round((jobProgress.done / jobProgress.total) * 100)
                    }%`,
                  }}
                />
              </div>
              <ImportLogPanel
                events={viewedJob?.events ?? []}
                progressLabel={importProgressLabel(jobProgress.done, jobProgress.total)}
                title={t("importLog")}
                waitingLabel={t("importWaiting")}
              />
              {viewedJob &&
              (viewedJob.credentials.length > 0 || viewedJob.failures.length > 0) ? (
                <div className="flex flex-wrap gap-2">
                  {viewedJob.failures.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 cursor-pointer rounded-md"
                      onClick={downloadErrors}
                    >
                      <Download className="me-2 h-4 w-4" />
                      {t("downloadErrors", { count: viewedJob.failures.length })}
                    </Button>
                  ) : null}
                  {viewedJob.credentials.length > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 cursor-pointer rounded-md"
                      onClick={downloadCredentials}
                    >
                      <Download className="me-2 h-4 w-4" />
                      {t("downloadCredentials", { count: viewedJob.credentials.length })}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
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
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <Label htmlFor="update-by-employee-id" className="text-sm">
                    {t("duplicateStrategy")}
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    {t("duplicateUpdateHint")}
                  </p>
                </div>
                <Switch
                  id="update-by-employee-id"
                  checked={duplicateStrategy === "update"}
                  onCheckedChange={(on) => setDuplicateStrategy(on ? "update" : "skip")}
                  disabled={importing}
                />
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
                  disabled={importing}
                />
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-muted/80">
                      <tr>
                        <th className={`${TABLE_HEAD_CLASS} px-2 py-1.5`}>{t("colStatus")}</th>
                        <th className={`${TABLE_HEAD_CLASS} px-2 py-1.5`}>{t("colName")}</th>
                        <th className={`${TABLE_HEAD_CLASS} px-2 py-1.5`}>{t("colPhone")}</th>
                        <th className={`${TABLE_HEAD_CLASS} px-2 py-1.5`}>{t("colEmployeeId")}</th>
                        <th className={`${TABLE_HEAD_CLASS} px-2 py-1.5`}>{t("colZone")}</th>
                        <th className={`${TABLE_HEAD_CLASS} px-2 py-1.5`}>{t("colRestaurants")}</th>
                        <th className={`${TABLE_HEAD_CLASS} px-2 py-1.5`}>{t("colActive")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.slice(0, 200).map((row) => (
                        <tr key={row.rowIndex} className="border-t border-border/60">
                          <td className="px-2 py-1">
                            <StatusPill variant={previewVariant(row, duplicateStrategy)} dot={false}>
                              {isImportRowReady(row, duplicateStrategy) &&
                              row.existingByEmployeeId
                                ? t("status.will_update")
                                : t(`status.${row.status}`)}
                            </StatusPill>
                          </td>
                          <td className="px-2 py-1">{row.full_name ?? "—"}</td>
                          <td className="px-2 py-1">{row.phone ?? "—"}</td>
                          <td className="px-2 py-1 tabular-nums">{row.employee_id ?? "—"}</td>
                          <td className="px-2 py-1">{row.zone_name ?? "—"}</td>
                          <td className="px-2 py-1">
                            {row.restaurant_names.length > 0
                              ? row.restaurant_names.join(", ")
                              : "—"}
                          </td>
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

        </div>
        {step !== "upload" ? (
          <AppModalFooter
            title={t("title")}
            subtitle={
              step === "job" && liveJob
                ? t("importProgress", {
                    done: jobProgress.done,
                    total: jobProgress.total,
                  })
                : step === "map"
                  ? requiredMapped
                    ? t("dropHint")
                    : t("mappingRequired")
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
                  disabled={summary.ready === 0}
                  onClick={handleImport}
                >
                  {t("import", { count: summary.ready })}
                </Button>
              </>
            ) : null}
            {step === "job" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 cursor-pointer rounded-md"
                  onClick={() => {
                    setStep("upload");
                    setPanel("previous");
                  }}
                >
                  {t("back")}
                </Button>
                {liveJob && canPauseImportJob(liveJob.status) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 cursor-pointer rounded-md"
                    onClick={() => void pause(liveJob.id)}
                  >
                    <Pause className="me-1.5 h-3.5 w-3.5" />
                    {t("pause")}
                  </Button>
                ) : null}
                {liveJob && canResumeImportJob(liveJob.status) ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 cursor-pointer rounded-md"
                    onClick={() => void resume(liveJob.id)}
                  >
                    <Play className="me-1.5 h-3.5 w-3.5" />
                    {t("resume")}
                  </Button>
                ) : null}
                {liveJob && canCancelImportJob(liveJob.status) ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-9 cursor-pointer rounded-md"
                    onClick={() => void cancel(liveJob.id)}
                  >
                    <Trash2 className="me-1.5 h-3.5 w-3.5" />
                    {t("cancelImport")}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant={
                    liveJob && canCancelImportJob(liveJob.status)
                      ? "outline"
                      : "default"
                  }
                  size="sm"
                  className="h-9 cursor-pointer rounded-md"
                  onClick={hideDialog}
                >
                  {liveJob && canCancelImportJob(liveJob.status)
                    ? t("hide")
                    : t("done")}
                </Button>
              </>
            ) : null}
          </AppModalFooter>
        ) : (
          <AppModalFooter title={t("title")} subtitle={t("formats")}>
            {isActiveImportJob(activeJob?.status ?? "previewed") ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 cursor-pointer rounded-md"
                onClick={hideDialog}
              >
                {t("hide")}
              </Button>
            ) : null}
          </AppModalFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
