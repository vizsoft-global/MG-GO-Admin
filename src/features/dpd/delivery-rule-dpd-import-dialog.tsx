"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2, Upload } from "lucide-react";
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
import {
  applyDpdTargetImport,
  previewDpdTargetImport,
  type DpdTargetImportRow,
} from "./dpd-actions";

function statusPill(
  status: DpdTargetImportRow["status"],
  t: ReturnType<typeof useTranslations>,
) {
  switch (status) {
    case "ok":
      return <StatusPill variant="success">{t("importStatus_ok")}</StatusPill>;
    case "unknown_name":
    case "invalid_target":
    case "invalid_period":
    case "no_rule":
    case "ambiguous_name":
      return <StatusPill variant="warning">{t(`importStatus_${status}`)}</StatusPill>;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
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
  const [rows, setRows] = useState<
    Array<{ scope_type?: string; name?: string; dpd_target?: string; dpd_period?: string }>
  >([]);
  const [preview, setPreview] = useState<DpdTargetImportRow[]>([]);

  const handleFile = async (file: File) => {
    const parsed = await parseSpreadsheetFile(file);
    const typeIdx = parsed.headers.findIndex((h) => /scope|type/i.test(h));
    const nameIdx = parsed.headers.findIndex((h) => /name|restaurant|zone/i.test(h) && !/type/i.test(h));
    const targetIdx = parsed.headers.findIndex((h) => /target/i.test(h));
    const periodIdx = parsed.headers.findIndex((h) => /period/i.test(h));
    const mapped = parsed.rows.map((cells) => ({
      scope_type: typeIdx >= 0 ? cells[typeIdx] : cells[0],
      name: nameIdx >= 0 ? cells[nameIdx] : cells[1],
      dpd_target: targetIdx >= 0 ? cells[targetIdx] : cells[2],
      dpd_period: periodIdx >= 0 ? cells[periodIdx] : cells[3],
    }));
    setRows(mapped);
    startTransition(async () => {
      try {
        setPreview(await previewDpdTargetImport(mapped));
      } catch {
        toast.error(t("bulkDpdPreviewFailed"));
      }
    });
  };

  const okCount = preview.filter((r) => r.status === "ok").length;
  const rejected = preview.filter((r) => r.status !== "ok");

  const exportErrors = () => {
    const header = "row,scope_type,name,dpd_target,dpd_period,status";
    const body = rejected
      .map(
        (r) =>
          `${r.row_number},${r.scope_type},${r.name},${r.dpd_target},${r.dpd_period},${r.status}`,
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
      toast.success(t("bulkDpdApplied", { count: result.updated }));
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
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row) => (
                    <TableRow key={row.row_number}>
                      <TableCell>{row.row_number}</TableCell>
                      <TableCell>{row.scope_type || "—"}</TableCell>
                      <TableCell>{row.name || "—"}</TableCell>
                      <TableCell>{row.dpd_target || "—"}</TableCell>
                      <TableCell>{row.dpd_period || "—"}</TableCell>
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
          subtitle={t("bulkDpdSubtitle", { ok: okCount, total: preview.length })}
        >
          <Button variant="outline" className="h-9 cursor-pointer" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            className="h-9 cursor-pointer"
            disabled={pending || okCount === 0}
            onClick={handleApply}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("bulkDpdApply", { count: okCount })}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
