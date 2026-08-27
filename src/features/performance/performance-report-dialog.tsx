"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CalendarRange, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { ToggleChip } from "@/components/app/toggle-chip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchDriverPerformanceReport } from "./performance-actions";
import {
  kuwaitToday,
  performanceRange,
  PERFORMANCE_RANGE_PRESETS,
  type PerformanceRangePreset,
} from "./performance-formulas";
import {
  buildPerformanceReportXlsx,
  downloadPerformanceReportXlsx,
} from "./performance-report-xlsx";
import type { PerformanceFiltersState } from "./performance-filters-sheet";

export function PerformanceReportDialog({
  open,
  onOpenChange,
  fromDate,
  toDate,
  filters,
  search,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromDate: string;
  toDate: string;
  filters: PerformanceFiltersState;
  search: string;
}) {
  const t = useTranslations("pages.performance.report");
  const today = kuwaitToday();
  const [from, setFrom] = useState(fromDate);
  const [to, setTo] = useState(toDate);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setFrom(fromDate);
    setTo(toDate);
  }, [open, fromDate, toDate]);

  const activePreset = PERFORMANCE_RANGE_PRESETS.find((preset) => {
    const range = performanceRange(preset, today);
    return range.from === from && range.to === to;
  });

  const handleGenerate = () => {
    if (!from || !to || to < from) {
      toast.error(t("errors.invalidRange"));
      return;
    }

    startTransition(async () => {
      try {
        const report = await fetchDriverPerformanceReport({
          from,
          to,
          filters: {
            search: search.trim() || undefined,
            partnerId: filters.partnerId || undefined,
            zoneId: filters.zoneId || undefined,
            restaurantId: filters.restaurantId || undefined,
            driverStatus: filters.driverStatus,
          },
        });

        if (report.rows.length === 0) {
          toast.error(t("empty"));
          return;
        }

        const buffer = await buildPerformanceReportXlsx(report);
        downloadPerformanceReportXlsx(report, buffer);

        if (report.truncated) {
          toast.warning(
            t("truncated", {
              rows: report.rows.length,
              total: report.totalCount,
            }),
          );
        } else {
          toast.success(t("success", { count: report.rows.length }));
        }
        onOpenChange(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        toast.error(
          message === "not_authorized"
            ? t("errors.notAuthorized")
            : message === "invalid_date_range"
              ? t("errors.invalidRange")
              : t("errors.failed"),
        );
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(520px,96vw)] overflow-visible p-0"
        showCloseButton
        closeOutside
      >
        <div className="space-y-3 px-5 pb-4 pt-4">
          <p className="text-sm text-muted-foreground">{t("hint")}</p>
          <div className="flex flex-wrap gap-1.5">
            {PERFORMANCE_RANGE_PRESETS.map((preset) => (
              <ToggleChip
                key={preset}
                size="md"
                icon={CalendarRange}
                selected={activePreset === preset}
                onClick={() => {
                  const range = performanceRange(preset, today);
                  setFrom(range.from);
                  setTo(range.to);
                }}
              >
                {t(`presets.${preset}`)}
              </ToggleChip>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="performance-report-from" className="text-xs">
                {t("from")}
              </Label>
              <Input
                id="performance-report-from"
                type="date"
                className="h-9"
                max={to || undefined}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="performance-report-to" className="text-xs">
                {t("to")}
              </Label>
              <Input
                id="performance-report-to"
                type="date"
                className="h-9"
                min={from || undefined}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {t("filtersNote")}
          </p>
        </div>
        <AppModalFooter title={t("title")} subtitle={t("subtitle")}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 cursor-pointer rounded-md"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9 cursor-pointer rounded-md px-4"
            disabled={isPending}
            onClick={handleGenerate}
          >
            {isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
            )}
            {t("generate")}
          </Button>
        </AppModalFooter>
      </DialogContent>
    </Dialog>
  );
}
