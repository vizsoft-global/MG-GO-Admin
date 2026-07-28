"use client";

import { CalendarRange, ChevronLeft, History, Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { TrackingGlassCard } from "./tracking-shell";

export function SelectDriverEmpty() {
  const t = useTranslations("pages.liveTracking");
  return (
    <TrackingGlassCard className="flex h-full min-h-[360px] items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <History className="h-5 w-5" />
        </span>
        <h3 className="mt-3 text-sm font-semibold text-foreground">{t("historySelectDriverTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("historySelectDriverHint")}</p>
      </div>
    </TrackingGlassCard>
  );
}

export function NoDataForDateEmpty({
  dateLabel,
  onPickYesterday,
  onPickLast7Days,
}: {
  dateLabel: string;
  onPickYesterday: () => void;
  onPickLast7Days: () => void;
}) {
  const t = useTranslations("pages.liveTracking");
  return (
    <TrackingGlassCard className="flex h-full min-h-[360px] items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <Inbox className="h-5 w-5" />
        </span>
        <h3 className="mt-3 text-sm font-semibold text-foreground">{t("historyNoDataTitle", { date: dateLabel })}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("historyNoDataHint")}</p>
        <div className="mt-3 flex items-center justify-center gap-2">
          <Button type="button" size="sm" variant="outline" className="cursor-pointer" onClick={onPickYesterday}>
            <ChevronLeft className="me-1 h-3.5 w-3.5" />
            {t("historyTryYesterday")}
          </Button>
          <Button type="button" size="sm" variant="outline" className="cursor-pointer" onClick={onPickLast7Days}>
            <CalendarRange className="me-1 h-3.5 w-3.5" />
            {t("historyTryLast7")}
          </Button>
        </div>
      </div>
    </TrackingGlassCard>
  );
}

export function HistoryLoadingSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="h-[92px] animate-pulse rounded-xl border border-border bg-muted/40" />
        ))}
      </div>
      <div className="h-[420px] animate-pulse rounded-xl border border-border bg-muted/40" />
      <div className="space-y-2 rounded-xl border border-border p-3">
        {Array.from({ length: 5 }).map((_, idx) => (
          <div key={idx} className="h-8 animate-pulse rounded-md bg-muted/40" />
        ))}
      </div>
    </div>
  );
}
