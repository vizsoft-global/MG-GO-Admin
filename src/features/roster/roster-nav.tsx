"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarClock, FileBarChart, MapPinned, SlidersHorizontal, Upload, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { kuwaitToday } from "@/features/driver-tracking/kuwait-time";
import { cn } from "@/lib/utils";
import { fetchRosterAlertsRange, fetchRosterChanges } from "./roster-actions";

const LINKS: Array<{ href: string; key: "navLive" | "navAlerts" | "navReport" | "navSetup" | "navUpload" | "navChanges"; icon: LucideIcon; badge?: "alerts" | "changes" }> = [
  { href: "/live-tracking-v2", key: "navLive", icon: MapPinned },
  { href: "/operations/roster/alerts", key: "navAlerts", icon: Bell, badge: "alerts" },
  { href: "/operations/roster/report", key: "navReport", icon: FileBarChart },
  { href: "/operations/roster", key: "navSetup", icon: SlidersHorizontal },
  { href: "/operations/roster/upload", key: "navUpload", icon: Upload },
  { href: "/operations/roster/changes", key: "navChanges", icon: CalendarClock, badge: "changes" },
];

export function RosterNav() {
  const t = useTranslations("pages.roster");
  const path = usePathname();
  const today = kuwaitToday();
  const alerts = useQuery({
    queryKey: ["roster", "alerts", today, today, null],
    queryFn: () => fetchRosterAlertsRange({ from: today, to: today }),
    staleTime: 30_000,
  });
  const changes = useQuery({
    queryKey: ["roster", "changes"],
    queryFn: fetchRosterChanges,
    staleTime: 30_000,
  });
  const openAlerts = alerts.data && "rows" in alerts.data ? alerts.data.rows.filter((row) => !row.acknowledged).length : 0;
  const waiting = changes.data && "rows" in changes.data ? changes.data.rows.filter((row) => row.status === "waiting").length : 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-[#E2DCD8] bg-white px-2.5 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <span className="px-2 text-sm font-semibold text-[#1D1B1A]">{t("hub")}</span>
        {LINKS.map((link) => {
          const active = link.href === "/operations/roster" ? path === link.href : path === link.href || path.startsWith(`${link.href}/`);
          const count = link.badge === "alerts" ? openAlerts : link.badge === "changes" ? waiting : 0;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-sm",
                active ? "bg-[#F6E9E5] font-semibold text-[#A8321D]" : "text-[#3D3734]",
              )}
            >
              <span className={cn("grid size-5 place-items-center rounded-md", active ? "bg-[#A8321D] text-white" : "bg-[#1D1B1A] text-white")}>
                <Icon className="size-3" fill="currentColor" strokeWidth={2.5} aria-hidden />
              </span>
              {t(link.key)}
              {count > 0 ? (
                <span className={cn("rounded-full px-1.5 text-[10px] font-semibold text-white", link.badge === "changes" ? "bg-[#B45309]" : "bg-[#B42318]")}>
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
