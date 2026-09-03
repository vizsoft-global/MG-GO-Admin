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
  DEFAULT_ORDERS_REPORT_FROM_TIME,
  DEFAULT_ORDERS_REPORT_TO_TIME,
  assertDeliveryOrdersReportRange,
  normalizeOrdersReportTime,
  ordersReportErrorKey,
} from "./orders-report-utils";
import {
  buildDeliveryOrdersReportXlsx,
  downloadDeliveryOrdersReportXlsx,
} from "./orders-report-xlsx";

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

function kuwaitPartsFromIso(iso: string | null | undefined): { ymd: string; hm: string } | null {
  if (!iso) return null;
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuwait",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuwait",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const hh = parts.find((part) => part.type === "hour")?.value ?? "00";
    const mm = parts.find((part) => part.type === "minute")?.value ?? "00";
    return { ymd, hm: `${hh}:${mm}` };
  } catch {
    return null;
  }
}

export function OrdersReportDialog({
  open,
  onOpenChange,
  initialFrom,
  initialTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFrom?: string | null;
  initialTo?: string | null;
}) {
  const t = useTranslations("pages.deliveries.ordersReport");
  const today = kuwaitToday();
  const [fromDate, setFromDate] = useState(addDaysYmd(today, -29));
  const [toDate, setToDate] = useState(today);
  const [fromTime, setFromTime] = useState(DEFAULT_ORDERS_REPORT_FROM_TIME);
  const [toTime, setToTime] = useState(DEFAULT_ORDERS_REPORT_TO_TIME);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const fromParts = kuwaitPartsFromIso(initialFrom);
    const toParts = kuwaitPartsFromIso(initialTo);
    setFromDate(fromParts?.ymd ?? addDaysYmd(today, -29));
    setToDate(toParts?.ymd ?? today);
    setFromTime(fromParts?.hm ?? DEFAULT_ORDERS_REPORT_FROM_TIME);
    setToTime(toParts?.hm ?? DEFAULT_ORDERS_REPORT_TO_TIME);
  }, [open, today, initialFrom, initialTo]);

  const handleGenerate = () => {
    const startHm = normalizeOrdersReportTime(fromTime, DEFAULT_ORDERS_REPORT_FROM_TIME);
    const endHm = normalizeOrdersReportTime(toTime, DEFAULT_ORDERS_REPORT_TO_TIME);
    try {
      assertDeliveryOrdersReportRange(fromDate, toDate, startHm, endHm);
    } catch (error) {
      toast.error(t(ordersReportErrorKey(error)));
      return;
    }

    startTransition(async () => {
      try {
        const report = await fetchDeliveryOrdersReport({
          from: fromDate,
          to: toDate,
          fromTime: startHm,
          toTime: endHm,
        });
        if (report.rows.length === 0) {
          toast.error(t("empty"));
          return;
        }
        const buffer = await buildDeliveryOrdersReportXlsx(report);
        downloadDeliveryOrdersReportXlsx(report, buffer);
        toast.success(t("success", { count: report.rows.length }));
        onOpenChange(false);
      } catch (error) {
        toast.error(t(ordersReportErrorKey(error)));
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
          <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
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
              <Label htmlFor="orders-report-from-time" className="text-xs">
                {t("fromTime")}
              </Label>
              <Input
                id="orders-report-from-time"
                type="time"
                className="h-9"
                value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
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
            <div className="space-y-1">
              <Label htmlFor="orders-report-to-time" className="text-xs">
                {t("toTime")}
              </Label>
              <Input
                id="orders-report-to-time"
                type="time"
                className="h-9"
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
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
