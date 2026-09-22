"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusPill } from "@/components/dashboard/status-pill";
import { parseSpreadsheetFile } from "@/lib/import/spreadsheet";
import { applyDpdTargetImport, previewDpdTargetImport } from "./dpd-actions";
import {
  applyableDpdTargetRows,
  mapDpdTargetImportSheet,
  type DpdTargetImportInputRow,
  type DpdTargetImportPreviewRow,
  type DpdTargetImportStatus,
} from "./delivery-rule-dpd-import";

function statusPill(
  status: DpdTargetImportStatus,
  t: ReturnType<typeof useTranslations>,
) {
  switch (status) {
    case "ok":
    case "create":
      return <StatusPill variant="success">{t(`importStatus_${status}`)}</StatusPill>;
    case "unknown_name":
    case "invalid_target":
    case "invalid_period":
    case "ambiguous_name":
    case "duplicate":
      return <StatusPill variant="warning">{t(`importStatus_${status}`)}</StatusPill>;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function ActionChip({
  status,
  t,
}: {
  status: DpdTargetImportStatus;
  t: ReturnType<typeof useTranslations>;
}) {
  if (status === "create") {
    return (
      <span className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-500 bg-emerald-100 px-2 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-400/50">
        <Check className="size-3.5" />
        {t("importStatus_create")}
      </span>
    );
  }
  if (status === "ok") {
    return (
      <span className="inline-flex h-7 items-center rounded-md border border-primary bg-primary/15 px-2 text-xs font-semibold text-primary">
        {t("importStatus_update")}
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

export function DeliveryRuleDpdImportDialog({
  open,
  onOpenChange,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}) {
  const t = useTranslations("pages.dpd");
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<DpdTargetImportInputRow[]>([]);
  const [preview, setPreview] = useState<DpdTargetImportPreviewRow[]>([]);

  const handleFile = async (file: File) => {
    const parsed = await parseSpreadsheetFile(file);
    const mapped = mapDpdTargetImportSheet(parsed.headers, parsed.rows);
    setRows(mapped);
    startTransition(async () => {
      try {
        setPreview(await previewDpdTargetImport(mapped));
      } catch {
        toast.error(t("bulkDpdPreviewFailed"));
      }
    });
  };

  const createCount = preview.filter((r) => r.status === "create").length;
  const updateCount = preview.filter((r) => r.status === "ok").length;
  const readyCount = applyableDpdTargetRows(preview).length;
  const rejected = preview.filter((r) => r.status !== "ok" && r.status !== "create");

  const exportErrors = () => {
    const header =
      "row,scope_type,name,partner,zone_code,dpd_target,dpd_period,status,note";
    const body = rejected
      .map(
        (r) =>
          `${r.row_number},${r.scope_type},${r.name},${r.partner},${r.zone_code},${r.dpd_target},${r.dpd_period},${r.status},${r.note ?? ""}`,
      )
      .join("\n");
    const blob = new Blob([`${header}\n${body}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "delivery-rule-dpd-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleApply = () => {
    startTransition(async () => {
      const result = await applyDpdTargetImport(rows);
      if ("error" in result) {
        toast.error(t("bulkDpdFailed"));
        return;
      }
      toast.success(
        t("bulkDpdApplied", { updated: result.updated, created: result.created }),
      );
      onApplied();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        closeOutside
        className="w-[min(1200px,96vw)] overflow-visible p-0"
      >
        <div className="space-y-3 px-5 pt-4 pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-xs hover:bg-accent">
              <Upload className="size-4" />
              {t("bulkDpd")}
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </label>
            <a
              href="/templates/delivery-rule-dpd-template.csv"
              download
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm hover:bg-accent"
            >
              <Download className="size-4" />
              {t("importDownloadTemplate")}
            </a>
            {rejected.length > 0 ? (
              <Button variant="outline" className="h-9 cursor-pointer" onClick={exportErrors}>
                {t("bulkDpdExportErrors")}
              </Button>
            ) : null}
          </div>
          {preview.length > 0 ? (
            <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>#</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colScope")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDpdTarget")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDpdPeriod")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colAction")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row) => (
                    <TableRow
                      key={row.row_number}
                      className={
                        row.status === "create"
                          ? "bg-emerald-50"
                          : row.status === "ok"
                            ? "bg-primary/[0.04]"
                            : undefined
                      }
                    >
                      <TableCell>{row.row_number}</TableCell>
                      <TableCell>{row.resolved_scope || row.scope_type || "—"}</TableCell>
                      <TableCell>
                        {row.name || "—"}
                        {row.note ? (
                          <span className="block text-[10px] text-muted-foreground">
                            {row.note}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>{row.dpd_target || "—"}</TableCell>
                      <TableCell>{row.dpd_period || "—"}</TableCell>
                      <TableCell>
                        <ActionChip status={row.status} t={t} />
                      </TableCell>
                      <TableCell>{statusPill(row.status, t)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("bulkDpdHint")}</p>
          )}
        </div>
        <AppModalFooter
          title={t("bulkDpdTitle")}
          subtitle={t("bulkDpdSubtitle", {
            create: createCount,
            update: updateCount,
            rejected: rejected.length,
            total: preview.length,
          })}
        >
          <Button variant="outline" className="h-9 cursor-pointer" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            className="h-9 cursor-pointer"
            disabled={pending || readyCount === 0}
            onClick={handleApply}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("bulkDpdApply", { count: readyCount })}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
