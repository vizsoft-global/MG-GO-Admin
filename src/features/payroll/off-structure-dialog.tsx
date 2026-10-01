"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
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
import { applyOffStructureBulk, setDriverOffStructure } from "./payroll-actions";
import {
  offStructureRowsToApply,
  parseOffStructureSheet,
  previewOffStructureRows,
  type OffStructurePreviewRow,
  type OffStructureRosterEntry,
} from "./off-structure-bulk";
import { PAYROLL_DEFAULT_OFF_DAYS } from "./payroll-formulas";
import type { PayrollMonthMeta, PayrollRiderRow } from "./payroll-types";

function downloadTemplate(monthKey: string) {
  const csv = [
    "Driver ID,Driver Name,Off Days,Month (YYYY-MM)",
    `10840,BILAL YUSSIF,4,${monthKey}`,
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `off-structure-template-${monthKey}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function OffStructureDialog({
  open,
  onOpenChange,
  month,
  riders,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: PayrollMonthMeta;
  riders: readonly PayrollRiderRow[];
  onApplied: () => void;
}) {
  const t = useTranslations("pages.payroll.offStructure");
  const [pending, startTransition] = useTransition();
  const [driverId, setDriverId] = useState<string | null>(null);
  const [offDays, setOffDays] = useState(String(PAYROLL_DEFAULT_OFF_DAYS));
  const [preview, setPreview] = useState<OffStructurePreviewRow[]>([]);

  const roster: OffStructureRosterEntry[] = useMemo(
    () =>
      riders.map((r) => ({
        driverId: r.driverId,
        name: r.name,
        employeeId: r.amId === "—" ? null : r.amId,
        driverCode: r.mgId === "—" ? null : r.mgId,
        offStructureDays: r.offStructureContracted ?? r.offStructureDays,
      })),
    [riders],
  );

  const items = useMemo(
    () =>
      riders.map((r) => ({
        value: r.driverId,
        label: r.name,
        hint: r.mgId,
        keywords: [r.amId, r.mgId, r.name],
      })),
    [riders],
  );

  const selected = riders.find((r) => r.driverId === driverId);

  function handleDriverChange(next: string | null) {
    setDriverId(next);
    const row = riders.find((r) => r.driverId === next);
    setOffDays(String(row?.offStructureDays ?? PAYROLL_DEFAULT_OFF_DAYS));
  }

  function handleSaveOne() {
    if (!driverId) {
      toast.error(t("pickDriver"));
      return;
    }
    const parsed = Number(offDays);
    if (!Number.isInteger(parsed) || parsed < 0) {
      toast.error(t("invalidOff"));
      return;
    }
    startTransition(async () => {
      const result = await setDriverOffStructure({
        driverId,
        monthKey: month.key,
        offDays: parsed,
      });
      if ("error" in result) {
        toast.error(t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
      onApplied();
    });
  }

  async function handleFile(file: File) {
    const sheet = await parseSpreadsheetFile(file, { raw: true });
    const parsed = parseOffStructureSheet([sheet.headers, ...sheet.rows]);
    if ("error" in parsed) {
      toast.error(t(`sheet_${parsed.error}`));
      setPreview([]);
      return;
    }
    setPreview(
      previewOffStructureRows({
        rows: parsed.rows,
        roster,
        monthKey: month.key,
        monthDays: month.days,
      }),
    );
  }

  function handleApplyBulk() {
    const rows = offStructureRowsToApply(preview);
    if (!rows.length) {
      toast.error(t("noneToApply"));
      return;
    }
    startTransition(async () => {
      const result = await applyOffStructureBulk({ monthKey: month.key, rows });
      if ("error" in result) {
        toast.error(t("bulkFailed"));
        return;
      }
      toast.success(t("bulkApplied", { applied: result.applied, skipped: result.skipped }));
      onApplied();
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        closeOutside
        className="w-[min(1200px,96vw)] overflow-visible p-0"
      >
        <div className="space-y-3 px-5 pt-4 pb-2">
          <div className="grid gap-2 lg:grid-cols-[1fr_140px_auto] lg:items-end">
            <SearchSelect
              items={items}
              value={driverId}
              onChange={handleDriverChange}
              placeholder={t("driverPlaceholder")}
              searchPlaceholder={t("driverSearch")}
              recentsKey="payroll-off-structure-driver"
            />
            <Input
              className="h-9"
              type="number"
              min={0}
              max={month.days}
              value={offDays}
              onChange={(e) => setOffDays(e.target.value)}
            />
            <Button type="button" className="h-9" disabled={pending} onClick={handleSaveOne}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t("saveOne")}
            </Button>
          </div>
          {selected ? (
            <p className="text-[10px] text-muted-foreground">
              {t("current", {
                days: selected.offStructureDays,
                source: t(`source_${selected.offStructureSource}`),
              })}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-xs hover:bg-accent">
              <Upload className="size-4" />
              {t("upload")}
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={() => downloadTemplate(month.key)}
            >
              <Download className="size-3.5" />
              {t("template")}
            </Button>
          </div>
          {preview.length ? (
            <div className="max-h-[240px] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colId")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colName")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colOff")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colPrev")}</TableHead>
                    <TableHead className={TABLE_HEAD_CLASS}>{t("colVerdict")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row) => (
                    <TableRow key={`${row.index}-${row.driverKey}`}>
                      <TableCell>{row.driverKey || "—"}</TableCell>
                      <TableCell>{row.name || "—"}</TableCell>
                      <TableCell>{row.offDays ?? "—"}</TableCell>
                      <TableCell>{row.previousOffDays ?? "—"}</TableCell>
                      <TableCell>
                        <StatusPill
                          variant={
                            row.verdict === "applied" || row.verdict === "no_change"
                              ? "success"
                              : "warning"
                          }
                        >
                          {t(`verdict_${row.verdict}`)}
                        </StatusPill>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>
        <AppModalFooter title={t("title")} subtitle={t("subtitle", { month: month.label })}>
          <Button type="button" variant="outline" className="h-9" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            className="h-9"
            disabled={pending || !preview.length}
            onClick={handleApplyBulk}
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t("applyValid")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
