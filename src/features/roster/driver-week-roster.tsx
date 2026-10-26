"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { TrackingGlassCard } from "@/features/live-tracking/tracking-shell";
import { fetchDriverRosterWeek } from "./roster-actions";

export function DriverWeekRoster({ driverId }: { driverId: string }) {
  const t = useTranslations("pages.roster");
  const query = useQuery({
    queryKey: ["roster", "week", driverId],
    queryFn: () => fetchDriverRosterWeek(driverId),
    enabled: Boolean(driverId),
    staleTime: 60_000,
  });
  const days = query.data && "days" in query.data ? query.data.days : [];
  if (query.isLoading || days.every((day) => !day.source)) return null;

  return (
    <TrackingGlassCard className="border-slate-200 bg-white p-4 dark:border-slate-700/80 dark:bg-slate-900">
      <p className="mb-2 text-sm font-semibold">{t("week")}</p>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
        {days.map((day) => (
          <div key={day.date} className="rounded-lg border border-border px-2 py-1 text-xs">
            <p className="font-semibold">{day.date}</p>
            <p className="text-muted-foreground">
              {day.off ? t("statuses.off") : `${day.start ?? "—"}–${day.end ?? "—"}`}
              {day.storeName ? ` · ${day.storeName}` : ""}
            </p>
          </div>
        ))}
      </div>
    </TrackingGlassCard>
  );
}
