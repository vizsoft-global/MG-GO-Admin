"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatKuwaitTime } from "@/features/driver-tracking/shift-adherence-display";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type RosterMapDriver = {
  driverId: string;
  name: string;
  employeeId: string;
  restaurantName: string;
  zoneName: string;
  status: string;
  start: string | null;
  end: string | null;
  actualIn: string | null;
  actualOut: string | null;
  minutesLate: number;
  minutesEarly: number;
  lateGraceMin: number;
  earlyDrop: boolean;
  earlyDropOrderId: string | null;
  earlyDropAt: string | null;
  originalStart: string | null;
  originalEnd: string | null;
  changeApprovedBy: string | null;
};

const CARD =
  "flex h-full min-h-0 flex-col overflow-hidden rounded-[14px] border border-[#E2DCD8] bg-white";

function driverInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

function statusPillClass(status: string): string {
  if (status === "on_shift") return "bg-[#E7F6EE] text-[#146C43]";
  if (status === "late") return "bg-[#FDF0DC] text-[#8A4B06]";
  if (status === "not_logged_in" || status === "no_show") return "bg-[#FDE7E5] text-[#A3221A]";
  if (status === "logged_out_early") return "bg-[#EEE8FB] text-[#5B34A8]";
  return "bg-[#F3F0EE] text-[#3D3734]";
}

function statusLabel(t: ReturnType<typeof useTranslations<"pages.roster">>, status: string): string {
  switch (status) {
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
      return status;
  }
}

function earlyDropLabel(
  t: ReturnType<typeof useTranslations<"pages.roster">>,
  orderId: string | null,
  at: string | null,
): string {
  const time = at ? formatKuwaitTime(at) : "—";
  if (!orderId) return `${t("legendEarly")} · ${time}`;
  return t("earlyDropLine", { order: orderId, time });
}

function scheduledRange(start: string | null, end: string | null): string {
  if (start && end) return `${start}–${end}`;
  return "—";
}

function actualRange(actualIn: string | null, actualOut: string | null): string {
  if (!actualIn) return "—";
  const login = formatKuwaitTime(actualIn);
  if (actualOut) return `${login} – ${formatKuwaitTime(actualOut)}`;
  return login;
}

export function RosterMapList(props: {
  drivers: RosterMapDriver[];
  total: number;
  selectedId: string | null;
  onSelect: (driverId: string) => void;
}) {
  const { drivers, total, selectedId, onSelect } = props;
  const t = useTranslations("pages.roster");

  return (
    <div className={CARD}>
      <header className="shrink-0 border-b border-[#E2DCD8] px-3 py-2">
        <p className="text-xs font-semibold text-[#5E5754]">
          {t("listHeading", { shown: drivers.length, total })}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {drivers.length === 0 ? (
          <p className="p-2 text-sm text-[#5E5754]">{t("noRows")}</p>
        ) : (
          <ul className="space-y-2">
            {drivers.map((driver) => {
              const selected = selectedId === driver.driverId;
              const note =
                driver.status === "on_shift" && driver.minutesLate > 0
                  ? t("withinGrace", { minutes: driver.lateGraceMin })
                  : driver.status === "late" && driver.minutesLate > 0
                    ? t("lateBy", { minutes: driver.minutesLate })
                    : driver.status === "logged_out_early" && driver.minutesEarly > 0
                      ? t("earlyBy", { minutes: driver.minutesEarly })
                      : null;

              return (
                <li key={driver.driverId}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "w-full cursor-pointer rounded-xl border border-[#E2DCD8] bg-white p-3 text-start transition-colors",
                      selected && "ring-1 ring-[#A8321D]",
                    )}
                    onClick={() => onSelect(driver.driverId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(driver.driverId);
                      }
                    }}
                  >
                    <div className="flex gap-2">
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#1D1B1A] text-xs font-semibold text-white"
                        aria-hidden
                      >
                        {driverInitials(driver.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#1D1B1A]">{driver.name}</p>
                            <p className="truncate text-[11px] text-[#5E5754]">
                              {driver.employeeId}
                              {driver.restaurantName ? ` · ${driver.restaurantName}` : ""}
                            </p>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              statusPillClass(driver.status),
                            )}
                          >
                            {statusLabel(t, driver.status)}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                          <div className="rounded-md bg-[#F9F7F6] px-2 py-1">
                            <p className="font-semibold uppercase tracking-wide text-[#5E5754]">
                              {t("scheduledBox")}
                            </p>
                            <p className="font-medium text-[#1D1B1A]">
                              {scheduledRange(driver.start, driver.end)}
                            </p>
                          </div>
                          <div className="rounded-md bg-[#F9F7F6] px-2 py-1">
                            <p className="font-semibold uppercase tracking-wide text-[#5E5754]">
                              {t("actualBox")}
                            </p>
                            <p className="font-medium text-[#1D1B1A]">
                              {actualRange(driver.actualIn, driver.actualOut)}
                            </p>
                          </div>
                        </div>
                        {note ? (
                          <p
                            className={cn(
                              "mt-1.5 text-[10px] font-medium",
                              driver.status === "on_shift" && "text-[#146C43]",
                              driver.status === "late" && "text-[#8A4B06]",
                              driver.status === "logged_out_early" && "text-[#5B34A8]",
                            )}
                          >
                            {note}
                          </p>
                        ) : null}
                        {driver.earlyDrop ? (
                          <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-[#B42318] px-2 py-0.5 text-[10px] font-semibold text-white">
                            <AlertTriangle className="size-3 fill-current" strokeWidth={2.5} aria-hidden />
                            {earlyDropLabel(t, driver.earlyDropOrderId, driver.earlyDropAt)}
                          </p>
                        ) : null}
                        {driver.originalStart && driver.originalEnd && driver.changeApprovedBy ? (
                          <Link
                            href="/operations/roster/changes"
                            className="mt-1.5 block text-[10px] font-medium text-[#A8321D] hover:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {t("scheduleWas", {
                              range: `${driver.originalStart}–${driver.originalEnd}`,
                              name: driver.changeApprovedBy,
                            })}
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function RosterScheduleLegend() {
  const t = useTranslations("pages.roster");

  return (
    <div className="rounded-[14px] border border-[#E2DCD8] bg-white p-3 shadow-sm">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-[#3D3734]">
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#146C43]" aria-hidden />
          {t("statuses.on_shift")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#D97706]" aria-hidden />
          {t("statuses.late")}
        </li>
        <li className="flex items-center gap-1.5">
          <AlertTriangle className="size-3 fill-[#B42318] text-[#B42318]" strokeWidth={2.5} aria-hidden />
          {t("legendEarly")}
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="flex size-3.5 items-center justify-center rounded-sm bg-[#1D1B1A] text-[8px] font-bold text-white"
            aria-hidden
          >
            R
          </span>
          {t("legendRestaurant")}
        </li>
      </ul>
      <p className="mt-2 text-[10px] leading-snug text-[#5E5754]">{t("noLiveNote")}</p>
    </div>
  );
}
