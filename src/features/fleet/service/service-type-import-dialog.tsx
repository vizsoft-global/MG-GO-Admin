"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { queryKeys } from "@/lib/query/query-keys";
import {
  previewServiceTypeImport,
  serviceTypeTemplateRows,
  writableImportRows,
  type ServiceTypeImportPreview,
  type ServiceTypeImportStatus,
} from "./service-type-import";
import { importServiceTypes } from "./service-types-actions";
import { serviceErrorKey } from "./use-service";
import type { ServiceTypeRow } from "./types";

const STATUS_TONE: Record<ServiceTypeImportStatus, string> = {
  create: "border-emerald-200 bg-emerald-50 text-emerald-700",
  update: "border-sky-200 bg-sky-50 text-sky-800",
  duplicate: "border-amber-200 bg-amber-50 text-amber-800",
  error: "border-rose-200 bg-rose-50 text-rose-700",
};

export function ServiceTypeImportDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: ServiceTypeRow[];
}) {
  const t = useTranslations("pages.settings.serviceTypes");
  const tErrors = useTranslations("pages.fleetService");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<ServiceTypeImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setPreview(null);
    setFileName("");
  }

  async function readFile(file: File) {
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
      const rows = sheet
        ? (XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][])
        : [];
      setPreview(
        previewServiceTypeImport(
          rows,
          existing.map((row) => ({
            key: row.key,
            label_en: row.label_en,
            label_ar: row.label_ar,
            category: row.category,
            is_active: row.is_active,
          })),
        ),
      );
      setFileName(file.name);
    } catch {
      toast.error(t("importParseFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview) return;
    setBusy(true);
    const result = await importServiceTypes(writableImportRows(preview));
    setBusy(false);
    if ("error" in result) {
      toast.error(tErrors(serviceErrorKey(result.error)));
      return;
    }
    toast.success(
      t("imported", { created: result.created, updated: result.updated, skipped: result.skipped }),
    );
    void queryClient.invalidateQueries({ queryKey: queryKeys.service.types() });
    onOpenChange(false);
    reset();
    router.refresh();
  }

  function downloadTemplate() {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(serviceTypeTemplateRows());
    XLSX.utils.book_append_sheet(workbook, sheet, "Service types");
    const out = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const blob = new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "dpd-service-types-import.xlsx";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }


  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent showCloseButton closeOutside className="w-[min(760px,96vw)]">
        <div className="max-h-[min(70dvh,600px)] space-y-3 overflow-y-auto px-5 pt-4 pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="h-9 max-w-[20rem]"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
              }}
            />
            <Button type="button" variant="outline" className="h-9" onClick={downloadTemplate}>
              {t("downloadTemplate")}
            </Button>
            {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
          </div>

          <p className="text-xs text-muted-foreground">{t("importHint")}</p>

          {preview ? (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{t("countTotal", { count: preview.counts.total })}</Badge>
                <Badge variant="outline" className={STATUS_TONE.create}>
                  {t("statusCreate")}: {preview.counts.create}
                </Badge>
                <Badge variant="outline" className={STATUS_TONE.update}>
                  {t("statusUpdate")}: {preview.counts.update}
                </Badge>
                <Badge variant="outline" className={STATUS_TONE.duplicate}>
                  {t("statusDuplicate")}: {preview.counts.duplicate}
                </Badge>
                <Badge variant="outline" className={STATUS_TONE.error}>
                  {t("statusError")}: {preview.counts.error}
                </Badge>
                {preview.truncated ? (
                  <Badge variant="outline" className={STATUS_TONE.error}>
                    {t("importTruncated")}
                  </Badge>
                ) : null}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="pb-1 text-start font-bold">{t("sheetRow")}</th>
                      <th className="pb-1 text-start font-bold">{t("labelEn")}</th>
                      <th className="pb-1 text-start font-bold">{t("labelAr")}</th>
                      <th className="pb-1 text-start font-bold">{t("category")}</th>
                      <th className="pb-1 text-start font-bold">{t("status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.slice(0, 200).map((item) => (
                      <tr key={`${item.sheetRow}-${item.key}`} className="border-t border-border">
                        <td className="py-1 tabular-nums">{item.sheetRow}</td>
                        <td className="py-1">{item.labelEn}</td>
                        <td className="py-1" dir="rtl">
                          {item.labelAr || "—"}
                        </td>
                        <td className="py-1 text-xs">{item.category}</td>
                        <td className="py-1">
                          <Badge variant="outline" className={STATUS_TONE[item.status]}>
                            {t(`status_${item.status}`)}
                          </Badge>
                          {item.message.startsWith("duplicate_of_row:") ? (
                            <span className="ms-1 text-xs text-muted-foreground">
                              {t("duplicateOf", { row: item.message.split(":")[1] ?? "" })}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("importEmpty")}</p>
          )}
        </div>
        <AppModalFooter title={t("import")} subtitle={t("subtitle")}>
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={() => {
              onOpenChange(false);
              reset();
            }}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            className="h-9"
            disabled={busy || !preview || preview.counts.create + preview.counts.update === 0}
            onClick={() => void apply()}
          >
            {t("importApply")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
