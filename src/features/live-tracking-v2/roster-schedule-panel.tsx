"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { formatKuwaitTime } from "@/features/driver-tracking/shift-adherence-display";
import { kuwaitToday } from "@/features/driver-tracking/kuwait-time";
import { fetchRosterAlerts } from "@/features/roster/roster-actions";
import { rosterError } from "@/features/roster/roster-result";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { RosterMapDriver } from "./roster-map-list";

const CARD = "h-full overflow-y-auto rounded-[14px] border border-[#E2DCD8] bg-white";

const SCHEDULE_STATUSES = [
  { key: "on_shift", color: "#146C43" },
  { key: "late", color: "#D97706" },
  { key: "not_logged_in", color: "#C8302A" },
  { key: "logged_out_early", color: "#7A52CC" },
  { key: "off", color: "#3D3734" },
] as const;

function alertKindLabel(t: ReturnType<typeof useTranslations<"pages.roster">>, kind: string): string {
  switch (kind) {
    case "early_drop":
      return t("statuses.early_drop");
    case "on_shift":
      return t("statuses.on_shift");
    case "late":
      return t("statuses.late");
    case "not_logged_in":
      return t("statuses.not_logged_in");
    case "no_show":
      return t("statuses.no_show");
    case "logged_out_early":
      return t("statuses.logged_out_early");
    case "off":
      return t("statuses.off");
    case "scheduled":
      return t("statuses.scheduled");
    default:
      return kind;
  }
}

function alertDotColor(kind: string): string {
  if (kind === "early_drop") return "bg-[#B42318]";
  if (kind === "late") return "bg-[#D97706]";
  if (kind === "logged_out_early") return "bg-[#7A52CC]";
  if (kind === "not_logged_in" || kind === "no_show") return "bg-[#C8302A]";
  return "bg-[#3D3734]";
}

export function RosterSchedulePanel(props: { drivers: RosterMapDriver[] }) {
  const { drivers } = props;
  const t = useTranslations("pages.roster");
  const today = kuwaitToday();

  const alerts = useQuery({
    queryKey: ["roster", "alerts", today, "live-panel"],
    queryFn: () => fetchRosterAlerts({ day: today }),
  });

  const alertRows =
    alerts.data && rosterError(alerts.data) === null && "rows" in alerts.data && Array.isArray(alerts.data.rows)
      ? alerts.data.rows
      : [];

  const statusCounts = SCHEDULE_STATUSES.map(({ key }) => ({
    key,
    count: drivers.filter((d) => d.status === key).length,
  }));
  const maxCount = Math.max(1, ...statusCounts.map((row) => row.count));

  const byRestaurant = [...drivers].reduce<Map<string, number>>((map, driver) => {
    const name = driver.restaurantName.trim() || "—";
    map.set(name, (map.get(name) ?? 0) + 1);
    return map;
  }, new Map());
  const restaurantRows = [...byRestaurant.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));

  const alertSlice = alertRows.slice(0, 6);

  return (
    <div className={cn(CARD, "p-3")}>
      <section className="space-y-2">
        <h2 className="text-[10px] font-bold uppercase tracking-wide text-[#5E5754]">{t("scheduleToday")}</h2>
        <ul className="space-y-1.5">
          {statusCounts.map(({ key, count }) => {
            const meta = SCHEDULE_STATUSES.find((row) => row.key === key)!;
            return (
              <li key={key} className="flex items-center gap-2 text-xs">
                <span className="w-[7.5rem] shrink-0 truncate font-medium text-[#3D3734]">
                  {alertKindLabel(t, key)}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${Math.round((count / maxCount) * 100)}%`,
                      backgroundColor: meta.color,
                      minWidth: count > 0 ? "0.5rem" : undefined,
                    }}
                  />
                </div>
                <span className="w-6 shrink-0 text-end font-semibold tabular-nums text-[#1D1B1A]">{count}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-4 space-y-2">
        <h2 className="text-[10px] font-bold uppercase tracking-wide text-[#5E5754]">{t("ridersByRestaurant")}</h2>
        {restaurantRows.length === 0 ? (
          <p className="text-xs text-[#5E5754]">{t("noRows")}</p>
        ) : (
          <ul className="space-y-1">
            {restaurantRows.map(({ name, count }) => (
              <li key={name} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-medium uppercase text-[#3D3734]">{name}</span>
                <span className="shrink-0 text-[#5E5754]">{t("riderCount", { count })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[10px] font-bold uppercase tracking-wide text-[#5E5754]">{t("alertsToday")}</h2>
          <Link href="/operations/roster/alerts" className="text-[11px] font-semibold text-[#A8321D] hover:underline">
            {t("viewAll")}
          </Link>
        </div>
        {alerts.isLoading ? (
          <p className="text-xs text-[#5E5754]">…</p>
        ) : rosterError(alerts.data) ? (
          <p className="text-xs text-[#5E5754]">—</p>
        ) : alertSlice.length === 0 ? (
          <p className="text-xs text-[#5E5754]">{t("noRows")}</p>
        ) : (
          <ul className="space-y-2">
            {alertSlice.map((row) => (
              <li key={row.id} className="flex gap-2 text-xs">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", alertDotColor(row.kind))} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-[#1D1B1A]">{alertKindLabel(t, row.kind)}</p>
                  <p className="truncate text-[11px] text-[#5E5754]">
                    {row.driverName || row.driverId}
                    {row.restaurantName ? ` · ${row.restaurantName}` : ""}
                  </p>
                  {row.at ? (
                    <p className="text-[10px] text-[#5E5754]">{formatKuwaitTime(row.at)}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
