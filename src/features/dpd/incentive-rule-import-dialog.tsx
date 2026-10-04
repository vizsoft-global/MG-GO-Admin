"use client";

import { useRef, useState, useTransition } from "react";
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
  type IncentiveImportInputRow,
  type IncentiveImportPreviewRow,
  type IncentiveImportStatus,
} from "./incentive-rule-import";

const NO_ROWS: IncentiveImportInputRow[] = [];
const NO_PREVIEW: IncentiveImportPreviewRow[] = [];

function statusPill(
  status: IncentiveImportStatus,
  t: ReturnType<typeof useTranslations>,
) {
  switch (status) {
    case "ok":
      return <StatusPill variant="success">{t("importStatus_ok")}</StatusPill>;
    case "would_replace":
      return (
        <StatusPill variant="warning">
          {t("importStatus_would_replace")}
        </StatusPill>
      );
    case "unknown_restaurant":
    case "ambiguous_restaurant":
    case "invalid_start":
    case "invalid_end":
    case "invalid_range":
    case "invalid_tiers":
    case "invalid_target":
    case "invalid_reward":
    case "invalid_target_type":
    case "invalid_period":
    case "invalid_priority":
    case "file_overlap":
      return (
        <StatusPill variant="warning">{t(`importStatus_${status}`)}</StatusPill>
      );
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
  const [rows, setRows] = useState<IncentiveImportInputRow[]>(NO_ROWS);
  const [preview, setPreview] = useState<IncentiveImportPreviewRow[]>(NO_PREVIEW);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Appling a sheet leaves the dialog mounted, so the finished preview has to be
   * cleared by hand — otherwise the next import opens on rows that were already
   * written to the database, and the file input keeps the old selection and
   * refuses to re-fire for the same file.
   */
  const resetImportState = () => {
    setRows(NO_ROWS);
    setPreview(NO_PREVIEW);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = (next: boolean) => {
    if (!next) resetImportState();
    onOpenChange(next);
  };

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
      resetImportState();
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
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
                ref={fileInputRef}
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
                    <TableHead className={TABLE_HEAD_CLASS}>
                      {t("colRuleName")}
                    </TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>
                      {t("colRestaurant")}
                    </TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>
                      {t("colStart")}
                    </TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>
                      {t("colEnd")}
                    </TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>
                      {t("colTargetShape")}
                    </TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>
                      {t("colStatus")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row) => (
                    <TableRow key={row.row_number}>
                      <TableCell>{row.row_number}</TableCell>
                      <TableCell className="max-w-[220px] truncate">
                        {row.rule_name || "—"}
                      </TableCell>
                      <TableCell>
                        {row.restaurant || "—"}
                        {row.replace_rule_name ? (
                          <p className="text-[10px] text-muted-foreground">
                            {t("wouldReplaceRule", {
                              name: row.replace_rule_name,
                            })}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>{row.start || "—"}</TableCell>
                      <TableCell>{row.end || "—"}</TableCell>
                      <TableCell className="text-xs">
                        {row.target_mode === "tiered"
                          ? `${t("targetTypes.tiered")} · ${row.tiers || "—"}`
                          : `${t("targetTypes.single")} · ${row.target_deliveries ?? "—"} @ ${
                              row.reward_mode === "per_delivery"
                                ? `${row.reward_per_delivery_kwd ?? 0} ${t("perDeliveryShort")}`
                                : `${row.reward_kwd} KD`
                            }`}
                      </TableCell>
                      <TableCell>{statusPill(row.status, t)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("incentivePreviewHint")}
            </p>
          )}
        </div>
        <AppModalFooter
          title={t("incentivePreviewTitle")}
          subtitle={t("incentivePreviewSubtitle", {
            ok: readyCount,
            total: preview.length,
          })}
        >
          <Button
            variant="outline"
            className="h-9 cursor-pointer"
            onClick={() => handleClose(false)}
          >
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
