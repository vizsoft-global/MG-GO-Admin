"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseSpreadsheetFile } from "@/lib/import/spreadsheet";
import { downloadWorkbookXlsx } from "@/features/drivers/import/export-xlsx";
import type { EmployeeCatalogRow } from "./employee-catalogs";
import { importSponsorships, type SponsorshipImportApplyError } from "./employee-catalogs-actions";
import {
  previewSponsorshipImport,
  sponsorshipImportTemplateSheets,
  type SponsorshipImportExisting,
  type SponsorshipImportRowError,
} from "./sponsorship-import";

function applyErrorMessage(
  error: SponsorshipImportApplyError,
  t: (key: string, values?: Record<string, number>) => string,
): string {
  switch (error) {
    case "empty":
      return t("import.empty");
    case "too_many":
      return t("import.tooMany");
    case "missing_columns":
      return t("import.missingColumns");
    case "nothing_to_apply":
      return t("import.nothingToApply");
    case "not_authorized":
      return t("errors.not_authorized");
    case "not_configured":
      return t("errors.not_configured");
    case "invalid_key":
      return t("errors.invalid_key");
    case "missing_fields":
      return t("errors.missing_fields");
    case "system_status_locked":
      return t("import.errors.system_status_locked");
    case "save_failed":
      return t("errors.save_failed");
    case "logo_file_too_large":
      return t("errors.logo_file_too_large");
    case "logo_invalid_type":
      return t("errors.logo_invalid_type");
    case "logo_upload_failed":
      return t("errors.logo_upload_failed");
    default: {
      const _never: never = error;
      return _never;
    }
  }
}

function rowErrorMessage(
  error: SponsorshipImportRowError,
  t: (key: string) => string,
): string {
  switch (error) {
    case "duplicate_key":
      return t("import.errors.duplicate_key");
    case "invalid_key":
      return t("import.errors.invalid_key");
    case "missing_fields":
      return t("import.errors.missing_fields");
    case "system_status_locked":
      return t("import.errors.system_status_locked");
    case "invalid_active":
      return t("import.errors.invalid_active");
    case "invalid_sort":
      return t("import.errors.invalid_sort");
    default: {
      const _never: never = error;
      return _never;
    }
  }
}

function toExisting(row: EmployeeCatalogRow): SponsorshipImportExisting {
  return {
    key: row.key,
    label_en: row.label_en,
    label_ar: row.label_ar,
    is_active: row.is_active,
    is_system: row.is_system,
    sort_order: row.sort_order,
  };
}

export function SponsorshipImportDialog({
  open,
  onOpenChange,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: readonly EmployeeCatalogRow[];
}) {
  const t = useTranslations("pages.settings.employeeCatalogs");
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetRows, setSheetRows] = useState<string[][]>([]);
  const [pending, startTransition] = useTransition();

  const existing = useMemo(() => rows.map(toExisting), [rows]);
  const preview = useMemo(
    () => previewSponsorshipImport({ headers, rows: sheetRows, existing }),
    [headers, sheetRows, existing],
  );
  const ready = preview.rows.filter((row) => row.status !== "error").length;

  const reset = () => {
    setFileName("");
    setHeaders([]);
    setSheetRows([]);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls") && !name.endsWith(".csv")) {
      toast.error(t("import.badFile"));
      return;
    }
    const parsed = await parseSpreadsheetFile(file, { sheetName: "Sponsorships" });
    setFileName(file.name);
    setHeaders(parsed.headers);
    setSheetRows(parsed.rows);
  };

  const apply = () => {
    startTransition(async () => {
      const result = await importSponsorships({ headers, rows: sheetRows });
      if ("error" in result) {
        toast.error(applyErrorMessage(result.error, t));
        return;
      }
      toast.success(t("import.applied", { created: result.created, updated: result.updated }));
      reset();
      onOpenChange(false);
      router.refresh();
    });
  };

  const fileError = fileName && preview.error ? applyErrorMessage(preview.error, t) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent
        showCloseButton
        closeOutside
        className="flex max-h-[min(92vh,880px)] w-[min(960px,96vw)] max-w-none flex-col gap-0 overflow-visible rounded-xl p-0 sm:max-w-[min(960px,96vw)]"
      >
        <div className="space-y-3 overflow-y-auto px-5 pt-4 pb-2">
          <p className="text-[10px] leading-4 text-muted-foreground">{t("import.logoNotInSheet")}</p>
          <p className="text-[10px] leading-4 text-muted-foreground">{t("import.capHint")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() =>
                downloadWorkbookXlsx("dpd-sponsorships-import.xlsx", sponsorshipImportTemplateSheets())
              }
            >
              <Download className="h-4 w-4" />
              {t("import.downloadSample")}
            </Button>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="h-9 max-w-xs"
              onChange={(event) => {
                void onFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
          </div>
          {fileError ? <p className="text-sm text-destructive">{fileError}</p> : null}
          {preview.rows.length > 0 ? (
            <div className="max-h-[min(48vh,420px)] overflow-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("import.colRow")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("import.colStatus")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colKey")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colLabelEn")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colLabelAr")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={`${row.rowIndex}-${row.key}`}>
                      <TableCell className="text-xs">{row.rowIndex}</TableCell>
                      <TableCell className="text-xs">
                        {row.status === "create"
                          ? t("import.statusCreate")
                          : row.status === "update"
                            ? t("import.statusUpdate")
                            : row.error
                              ? rowErrorMessage(row.error, t)
                              : t("import.statusError")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.key || "—"}</TableCell>
                      <TableCell className="text-sm">{row.label_en || "—"}</TableCell>
                      <TableCell className="text-sm">{row.label_ar || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
        <AppModalFooter title={t("import.title")} subtitle={t("import.subtitle")}>
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            className="h-9"
            disabled={pending || ready === 0}
            onClick={() => apply()}
          >
            <Upload className="h-4 w-4" />
            {t("import.apply")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
