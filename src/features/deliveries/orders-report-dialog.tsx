"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { kuwaitToday } from "@/features/driver-tracking/kuwait-time";
import { fetchDeliveryOrdersReport } from "./orders-report-actions";
import {
  buildDeliveryOrdersReportXlsx,
  downloadDeliveryOrdersReportXlsx,
} from "./orders-report-xlsx";

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

export function OrdersReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("pages.deliveries.ordersReport");
  const today = kuwaitToday();
  const [fromDate, setFromDate] = useState(addDaysYmd(today, -29));
  const [toDate, setToDate] = useState(today);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setFromDate(addDaysYmd(today, -29));
    setToDate(today);
  }, [open, today]);

  const handleGenerate = () => {
    if (!fromDate || !toDate) {
      toast.error(t("invalidRange"));
      return;
    }
    if (fromDate > toDate) {
      toast.error(t("invalidRange"));
      return;
    }

    startTransition(async () => {
      try {
        const report = await fetchDeliveryOrdersReport({ from: fromDate, to: toDate });
        if (report.rows.length === 0) {
          toast.error(t("empty"));
          return;
        }
        const buffer = await buildDeliveryOrdersReportXlsx(report);
        downloadDeliveryOrdersReportXlsx(report, buffer);
        toast.success(t("success", { count: report.rows.length }));
        onOpenChange(false);
      } catch {
        toast.error(t("failed"));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(480px,96vw)] overflow-visible p-0"
        showCloseButton
        closeOutside
      >
        <div className="space-y-3 px-5 pb-4 pt-4">
          <p className="text-sm text-muted-foreground">{t("hint")}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="orders-report-from" className="text-xs">
                {t("from")}
              </Label>
              <Input
                id="orders-report-from"
                type="date"
                className="h-9"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="orders-report-to" className="text-xs">
                {t("to")}
              </Label>
              <Input
                id="orders-report-to"
                type="date"
                className="h-9"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>
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
