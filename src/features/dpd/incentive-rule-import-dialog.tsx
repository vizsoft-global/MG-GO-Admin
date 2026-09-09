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
import { applyIncentiveRuleImport, previewIncentiveRuleImport } from "./dpd-actions";
import {
  applyableIncentiveImportRows,
  mapIncentiveImportSheet,
  type IncentiveImportPreviewRow,
  type IncentiveImportStatus,
} from "./incentive-rule-import";

function statusPill(
  status: IncentiveImportStatus,
  t: ReturnType<typeof useTranslations>,
) {
  switch (status) {
    case "ok":
      return <StatusPill variant="success">{t("importStatus_ok")}</StatusPill>;
    case "would_replace":
      return <StatusPill variant="warning">{t("importStatus_would_replace")}</StatusPill>;
    case "unknown_restaurant":
    case "ambiguous_restaurant":
    case "invalid_start":
    case "invalid_end":
    case "invalid_range":
    case "invalid_tiers":
    case "file_overlap":
      return <StatusPill variant="warning">{t(`importStatus_${status}`)}</StatusPill>;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function IncentiveRuleImportDialog({
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
    Array<{ restaurant?: string; start?: string; end?: string; tiers?: string }>
  >([]);
  const [preview, setPreview] = useState<IncentiveImportPreviewRow[]>([]);

  const handleFile = async (file: File) => {
    const parsed = await parseSpreadsheetFile(file, { raw: true });
    const mapped = mapIncentiveImportSheet(parsed.headers, parsed.rows);
    setRows(mapped);
    startTransition(async () => {
      try {
        setPreview(await previewIncentiveRuleImport(mapped));
      } catch {
        toast.error(t("incentivePreviewFailed"));
      }
    });
  };

  const readyCount = applyableIncentiveImportRows(preview).length;

  const handleApply = () => {
    startTransition(async () => {
      const result = await applyIncentiveRuleImport(rows);
      if ("error" in result) {
        toast.error(t("incentiveApplyFailed"));
        return;
      }
      toast.success(
        t("incentiveApplied", {
          applied: result.applied,
          replaced: result.replaced,
          rejected: result.rejected,
        }),
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
              {t("incentivePreview")}
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
              href="/templates/incentive-rule-template.csv"
              download
              className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm hover:bg-accent"
            >
              <Download className="size-4" />
              {t("importDownloadTemplate")}
            </a>
          </div>
          {preview.length > 0 ? (
            <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>#</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colRestaurant")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colStart")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colEnd")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colTiers")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row) => (
                    <TableRow key={row.row_number}>
                      <TableCell>{row.row_number}</TableCell>
                      <TableCell>
                        {row.restaurant || "—"}
                        {row.replace_rule_name ? (
                          <p className="text-[10px] text-muted-foreground">
                            {t("wouldReplaceRule", { name: row.replace_rule_name })}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>{row.start || "—"}</TableCell>
                      <TableCell>{row.end || "—"}</TableCell>
                      <TableCell>{row.tiers || "—"}</TableCell>
                      <TableCell>{statusPill(row.status, t)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("incentivePreviewHint")}</p>
          )}
        </div>
        <AppModalFooter
          title={t("incentivePreviewTitle")}
          subtitle={t("incentivePreviewSubtitle", {
            ok: readyCount,
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
            {t("incentiveApply", { count: readyCount })}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
