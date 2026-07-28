"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Upload } from "lucide-react";
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
import {
  useApplyImportBatch,
  useResolveImportPreview,
  type ImportPreviewRow,
} from "../use-verifications";
import { MappingBoard } from "./mapping-board";
import {
  guessColumnMapping,
  isWideDateLayout,
  loadStoredMapping,
  mapRowsFromSheet,
  parseSpreadsheetFile,
  saveStoredMapping,
  unpivotWideRows,
  type ParsedSheet,
} from "./parse";
import type { ImportTargetField } from "../types";

type Step = "upload" | "map" | "preview";

function previewVariant(
  status: ImportPreviewRow["status"],
): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "ok":
      return "success";
    case "duplicate":
      return "warning";
    default:
      return "danger";
  }
}

export function BulkImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.verifications.import");
  const [step, setStep] = useState<Step>("upload");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<ImportTargetField, string>>>({});
  const [unpivot, setUnpivot] = useState(true);
  const [preview, setPreview] = useState<ImportPreviewRow[]>([]);
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "replace">("skip");
  const [isPending, startTransition] = useTransition();

  const resolvePreview = useResolveImportPreview();
  const applyBatch = useApplyImportBatch();

  const wideLayout = sheet ? isWideDateLayout(sheet.headers) : false;

  const summary = useMemo(() => {
    const ready = preview.filter((r) => r.status === "ok" && !r.skip).length;
    const duplicate = preview.filter((r) => r.status === "duplicate").length;
    const unmatched = preview.filter(
      (r) =>
        r.status === "unmatched_driver" || r.status === "unmatched_restaurant",
    ).length;
    return { ready, duplicate, unmatched, total: preview.length };
  }, [preview]);

  const reset = useCallback(() => {
    setStep("upload");
    setSheet(null);
    setFileName("");
    setMapping({});
    setPreview([]);
  }, []);

  const handleFile = async (file: File) => {
    const parsed = await parseSpreadsheetFile(file);
    setSheet(parsed);
    setFileName(file.name);
    const stored = loadStoredMapping(parsed.headerSignature);
    const guessed = guessColumnMapping(parsed.headers);
    setMapping({ ...guessed, ...stored });
    setUnpivot(isWideDateLayout(parsed.headers));
    setStep("map");
  };

  const buildMappedRows = () => {
    if (!sheet) return [];
    if (unpivot && wideLayout) {
      return unpivotWideRows(sheet.headers, sheet.rows, mapping);
    }
    return mapRowsFromSheet(sheet.headers, sheet.rows, mapping);
  };

  const goPreview = () => {
    if (!sheet) return;
    saveStoredMapping(sheet.headerSignature, mapping);
    const mapped = buildMappedRows();
    startTransition(async () => {
      try {
        const rows = await resolvePreview.mutateAsync(mapped);
        setPreview(rows);
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
      });
      if ("error" in result) {
        toast.error(t("importFailed"), {
          description: result.errorDetail,
        });
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
        t("importSuccess", { applied: result.applied, skipped: result.skipped }),
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
          ) : null}

          {step === "map" && sheet ? (
            <>
              {wideLayout ? (
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <Label htmlFor="unpivot-toggle" className="text-sm">
                    {t("unpivotDates")}
                  </Label>
                  <Switch
                    id="unpivot-toggle"
                    checked={unpivot}
                    onCheckedChange={setUnpivot}
                  />
                </div>
              ) : null}
              <MappingBoard
                headers={sheet.headers}
                sampleRow={sheet.rows[0] ?? []}
                mapping={mapping}
                onMappingChange={setMapping}
              />
            </>
          ) : null}

          {step === "preview" ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("previewSummary", {
                  ready: summary.ready,
                  duplicate: summary.duplicate,
                  unmatched: summary.unmatched,
                })}
              </p>
              <div className="flex items-center gap-3">
                <Label className="text-sm">{t("duplicateStrategy")}</Label>
                <Select
                  items={[
                    { value: "skip", label: t("duplicateSkip") },
                    { value: "replace", label: t("duplicateReplace") },
                  ]}
                  value={duplicateStrategy}
                  onValueChange={(v) => {
                    if (v === "skip" || v === "replace") setDuplicateStrategy(v);
                  }}
                >
                  <SelectTrigger className="h-8 w-48 cursor-pointer rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip" label={t("duplicateSkip")}>
                      {t("duplicateSkip")}
                    </SelectItem>
                    <SelectItem value="replace" label={t("duplicateReplace")}>
                      {t("duplicateReplace")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted/80">
                    <tr>
                      <th className="px-2 py-1.5">{t("colStatus")}</th>
                      <th className="px-2 py-1.5">{t("colDriver")}</th>
                      <th className="px-2 py-1.5">{t("colRestaurant")}</th>
                      <th className="px-2 py-1.5">{t("colDate")}</th>
                      <th className="px-2 py-1.5">{t("colCount")}</th>
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
                        <td className="px-2 py-1">{row.driver_name ?? "—"}</td>
                        <td className="px-2 py-1">
                          {row.restaurant_resolved_name ?? "—"}
                        </td>
                        <td className="px-2 py-1">{row.service_date ?? "—"}</td>
                        <td className="px-2 py-1 tabular-nums">
                          {row.reported_count ?? "—"}
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
                    unmatched: summary.unmatched,
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
