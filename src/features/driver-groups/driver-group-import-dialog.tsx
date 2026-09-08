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
  applyGroupMemberImport,
  previewGroupMemberImport,
  type GroupImportPreviewRow,
} from "./driver-groups-actions";

function statusPill(
  status: GroupImportPreviewRow["status"],
  t: ReturnType<typeof useTranslations>,
) {
  switch (status) {
    case "ok":
      return <StatusPill variant="success">{t("importStatusOk")}</StatusPill>;
    case "already_in_group":
      return <StatusPill variant="warning">{t("importStatusAlready")}</StatusPill>;
    case "duplicate":
      return <StatusPill variant="warning">{t("importStatusDuplicate")}</StatusPill>;
    case "blocked":
    case "archived":
      return <StatusPill variant="danger">{t(`importStatus_${status}`)}</StatusPill>;
    case "unknown_id":
    case "ambiguous":
    case "empty":
      return <StatusPill variant="warning">{t(`importStatus_${status}`)}</StatusPill>;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function DriverGroupImportDialog({
  groupId,
  open,
  onOpenChange,
  onApplied,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: () => void;
}) {
  const t = useTranslations("pages.driverGroups");
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Array<{ employee_id?: string; driver_code?: string }>>([]);
  const [preview, setPreview] = useState<GroupImportPreviewRow[]>([]);

  const handleFile = async (file: File) => {
    const parsed = await parseSpreadsheetFile(file);
    const empIdx = parsed.headers.findIndex((h) => /employee\s*id/i.test(h));
    const codeIdx = parsed.headers.findIndex((h) => /driver\s*code|mg\s*id/i.test(h));
    const mapped = parsed.rows.map((cells) => ({
      employee_id: empIdx >= 0 ? cells[empIdx] : cells[0],
      driver_code: codeIdx >= 0 ? cells[codeIdx] : "",
    }));
    setRows(mapped);
    startTransition(async () => {
      try {
        setPreview(await previewGroupMemberImport(groupId, mapped));
      } catch {
        toast.error(t("importPreviewFailed"));
      }
    });
  };

  const okCount = preview.filter((r) => r.status === "ok").length;
  const rejected = preview.filter((r) => r.status !== "ok");

  const exportErrors = () => {
    const header = "row,employee_id,driver_code,status";
    const body = rejected
      .map((r) => `${r.row_number},${r.employee_id},${r.driver_code},${r.status}`)
      .join("\n");
    const blob = new Blob([`${header}\n${body}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "group-import-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleApply = () => {
    startTransition(async () => {
      const result = await applyGroupMemberImport(groupId, rows);
      if ("error" in result) {
        toast.error(t("importApplyFailed"));
        return;
      }
      toast.success(t("importApplied", { count: result.added }));
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
              {t("importUpload")}
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
              href="/templates/notification-import-template.csv"
              download
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm hover:bg-accent"
            >
              <Download className="size-4" />
              {t("importDownloadTemplate")}
            </a>
            {rejected.length > 0 ? (
              <Button variant="outline" className="h-9 cursor-pointer" onClick={exportErrors}>
                {t("importExportErrors")}
              </Button>
            ) : null}
          </div>
          {preview.length > 0 ? (
            <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>#</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colEmployeeId")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDriverCode")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colDriver")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row) => (
                    <TableRow key={row.row_number}>
                      <TableCell>{row.row_number}</TableCell>
                      <TableCell>{row.employee_id || "—"}</TableCell>
                      <TableCell>{row.driver_code || "—"}</TableCell>
                      <TableCell>{row.full_name ?? "—"}</TableCell>
                      <TableCell>{statusPill(row.status, t)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("importHint")}</p>
          )}
        </div>
        <AppModalFooter
          title={t("importTitle")}
          subtitle={t("importSubtitle", { ok: okCount, total: preview.length })}
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
            {t("importApply", { count: okCount })}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
