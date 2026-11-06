"use client";

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { queryKeys } from "@/lib/query/query-keys";
import { importPayrollDayHours } from "./payroll-actions";
import {
  previewUpload,
  uploadSummaryText,
  uploadTemplateCsv,
  type UploadPreview,
  type UploadRosterEntry,
} from "./payroll-daily-upload";
import { projectConfigOf, type PayrollProjectClient, type PayrollProjectView } from "./payroll-projects";
import type { PayrollRiderRow } from "./payroll-types";

/** `MGHub-Keeta-Working-hours-template.csv` */
function templateName(view: PayrollProjectView, hours: boolean): string {
  const config = projectConfigOf(view);
  const figure = hours ? "Working-hours" : "Orders";
  return `MGHub-${config.exportName}-${figure}-template.csv`;
}

/**
 * **Upload daily data** — the one door that puts money-relevant figures into a
 * project's cells.
 *
 * The file is parsed and validated **before** a single write, and the preview
 * lists each rejection with its line number and reason, so a bad MG ID costs one
 * cell rather than the whole sheet. The accepted rows go to the server, which
 * re-checks every rule against the live roster — a file for one project can never
 * change another project's data, and that has to hold even if this dialog is
 * wrong.
 */
export function PayrollDailyUploadDialog({
  open,
  onOpenChange,
  view,
  views,
  riders,
  monthPrefix,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: PayrollProjectView;
  /** The active client catalog, so a custom client's day shape is honoured. */
  views?: readonly PayrollProjectClient[];
  riders: readonly PayrollRiderRow[];
  /** `YYYY-MM` of the month being shown. */
  monthPrefix: string;
  today: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton closeOutside className="w-[min(720px,96vw)]">
        {open ? (
          <UploadForm
            key={view}
            view={view}
            views={views}
            riders={riders}
            monthPrefix={monthPrefix}
            today={today}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({
  view,
  views,
  riders,
  monthPrefix,
  today,
  onClose,
}: {
  view: PayrollProjectView;
  views?: readonly PayrollProjectClient[];
  riders: readonly PayrollRiderRow[];
  monthPrefix: string;
  today: string;
  onClose: () => void;
}) {
  const t = useTranslations("pages.payroll.upload");
  const tErrors = useTranslations("pages.payroll.upload.rejects");
  const tProjects = useTranslations("pages.payroll.projects");
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [saving, setSaving] = useState(false);

  const config = projectConfigOf(view, views);
  const hours = config.usesUploadedHours;
  const valueHeader = hours ? t("hoursColumn") : t("ordersColumn");

  const lookup = useMemo(() => {
    const map = new Map<string, UploadRosterEntry>();
    for (const row of riders) {
      const entry: UploadRosterEntry = {
        driverId: row.driverId,
        // The card the rider is drawn under is the project this upload writes to.
        projectKey: view,
      };
      for (const key of [row.mgId, row.amId]) {
        const trimmed = (key ?? "").trim();
        if (trimmed && trimmed !== "—") map.set(trimmed.toLowerCase(), entry);
      }
    }
    return map;
  }, [riders, view]);

  async function handleFile(file: File | null | undefined) {
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    setPreview(
      previewUpload(
        text,
        {
          projectKey: view,
          today,
          hours,
          lookup: (mgId) => lookup.get(mgId.trim().toLowerCase()) ?? null,
        },
        { monthPrefix },
      ),
    );
  }

  function downloadTemplate() {
    const examples = riders.slice(0, 5).map((row, index) => ({
      mgId: row.mgId === "—" ? row.amId : row.mgId,
      date: `${monthPrefix}-${String(Math.min(index + 1, Number(today.slice(8, 10)) || 1)).padStart(2, "0")}`,
    }));
    const csv = uploadTemplateCsv(valueHeader, examples);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = templateName(view, hours);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function apply() {
    if (!preview || preview.accepted.length === 0) return;
    setSaving(true);
    try {
      const image = preview.accepted;
      const result = await importPayrollDayHours(
        view,
        image.map((row) => ({ row: row.line, mgId: row.mgId, date: row.date, hours: row.value })),
      );
      toast.success(t("applied", { count: result.applied }));
      if (result.rejected.length > 0) {
        toast.warning(t("partlyRejected", { count: result.rejected.length }));
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.all() });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
    } finally {
      setSaving(false);
    }
  }

  const accepted = preview?.accepted.length ?? 0;
  const rejected = preview?.rejected ?? [];

  return (
    <>
      <div className="space-y-3 px-5 pt-4 pb-2">
        <div className="space-y-1">
          <p className="text-sm font-semibold">
            {t("title", { project: config.label ?? tProjects(config.labelKey) })}
          </p>
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="me-1 size-4" />
            {t("chooseFile")}
          </Button>
          <Button type="button" variant="ghost" className="h-9" onClick={downloadTemplate}>
            {t("downloadTemplate")}
          </Button>
          {fileName ? (
            <span className="truncate text-xs text-muted-foreground">{fileName}</span>
          ) : null}
        </div>

        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {t("shape", { value: valueHeader })}
        </div>

        {preview ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold">{uploadSummaryText(preview)}</p>
            {rejected.length > 0 ? (
              <div className="max-h-40 overflow-auto rounded-lg border border-destructive/30">
                <table className="w-full border-collapse text-xs">
                  <thead className="bg-destructive/5 text-start">
                    <tr>
                      <th className="px-2 py-1 text-start">{t("colLine")}</th>
                      <th className="px-2 py-1 text-start">{t("colId")}</th>
                      <th className="px-2 py-1 text-start">{t("colReason")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rejected.slice(0, 40).map((row) => (
                      <tr key={`${row.line}-${row.code}`} className="border-t border-border/60">
                        <td className="px-2 py-1 tabular-nums">{row.line}</td>
                        <td className="px-2 py-1 tabular-nums">{row.mgId ?? "—"}</td>
                        <td className="px-2 py-1 text-destructive">{tErrors(row.code)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <AppModalFooter title={t("footerTitle")} subtitle={t("footerHint")}>
        <Button type="button" variant="outline" className="h-9" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button
          type="button"
          className="h-9"
          disabled={saving || accepted === 0}
          onClick={() => void apply()}
        >
          {saving ? <Loader2 className="me-1 size-4 animate-spin" /> : null}
          {t("apply", { count: accepted })}
        </Button>
      </AppModalFooter>
    </>
  );
}
