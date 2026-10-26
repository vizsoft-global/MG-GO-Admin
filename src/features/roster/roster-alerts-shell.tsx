"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { SearchSelect } from "@/components/ui/search-select";
import { formatKuwaitDateTime, formatKuwaitTime } from "@/features/driver-tracking/shift-adherence-display";
import { addDays, kuwaitToday } from "@/features/driver-tracking/kuwait-time";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ackRosterAlert, fetchRosterAlertDetail, fetchRosterAlerts, fetchRosterDirectory } from "./roster-actions";
import { RosterNav } from "./roster-nav";
import { rosterError } from "./roster-result";
import { rosterBtn, rosterBtnSoft, rosterCanvas, rosterCard, rosterH1, rosterMuted, rosterTd, rosterTh } from "./roster-ui";

const ATTENDANCE = new Set(["late", "not_logged_in", "no_show", "logged_out_early"]);
const OUTCOMES = ["outcomeWarned", "outcomeEscalated", "outcomeValid", "outcomeFalse"] as const;
const RULES = ["near_restaurant", "short_duration", "far_customer", "missing_proof"] as const;

type Preset = "today" | "yesterday" | "last7";
type OutcomeKey = (typeof OUTCOMES)[number];

function daysFor(preset: Preset, today: string) {
  if (preset === "today") return [today];
  if (preset === "yesterday") return [addDays(today, -1)];
  return Array.from({ length: 7 }, (_, index) => addDays(today, -index));
}

function kindTone(kind: string) {
  if (kind === "early_drop") return "bg-[#B42318] text-white";
  if (kind === "late") return "bg-[#FDF0DC] text-[#8A4B06]";
  if (kind === "logged_out_early") return "bg-[#EEE8FB] text-[#5B34A8]";
  if (kind === "not_logged_in" || kind === "no_show") return "bg-[#FDE7E5] text-[#A3221A]";
  return "bg-[#F3F0EE] text-[#3D3734]";
}

export function RosterAlertsShell() {
  const t = useTranslations("pages.roster");
  const client = useQueryClient();
  const today = kuwaitToday();
  const [preset, setPreset] = useState<Preset>("today");
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "attendance" | "early">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<OutcomeKey | "">("");
  const alerts = useQuery({
    queryKey: ["roster", "alerts", preset, today, restaurantId],
    queryFn: async () => {
      const pages = await Promise.all(daysFor(preset, today).map((day) => fetchRosterAlerts({ day, restaurantId })));
      const failure = pages.map((page) => rosterError(page)).find((code) => code);
      const rows = pages.flatMap((page) => ("rows" in page && Array.isArray(page.rows) ? page.rows : []));
      return { rows, failure: failure ?? null };
    },
  });
  const directory = useQuery({ queryKey: ["roster", "directory"], queryFn: fetchRosterDirectory });
  const detail = useQuery({
    queryKey: ["roster", "alert", selected],
    queryFn: () => fetchRosterAlertDetail(selected ?? ""),
    enabled: Boolean(selected),
  });
  const rows = alerts.data?.rows ?? [];
  const places = directory.data && "restaurants" in directory.data ? directory.data.restaurants : [];
  const shown = rows.filter((row) => {
    if (tab === "attendance") return ATTENDANCE.has(row.kind);
    if (tab === "early") return row.kind === "early_drop";
    return true;
  });
  const current = rows.find((row) => row.id === selected) ?? null;
  const detailRow = detail.data && "reasons" in detail.data && Array.isArray(detail.data.reasons) ? detail.data : null;
  const thresholds = detailRow && "thresholds" in detailRow ? detailRow.thresholds : null;
  const reasons = new Set(detailRow?.reasons ?? []);
  const lateCount = rows.filter((row) => row.kind === "late").length;
  const earlyCount = rows.filter((row) => row.kind === "logged_out_early").length;
  const noneCount = rows.filter((row) => row.kind === "not_logged_in" || row.kind === "no_show").length;
  const dropCount = rows.filter((row) => row.kind === "early_drop").length;

  function outcomeText(value: string) {
    if ((OUTCOMES as readonly string[]).includes(value)) return t(value as OutcomeKey);
    return value;
  }

  function ruleText(rule: (typeof RULES)[number]) {
    if (rule === "near_restaurant") return `${t("nearRule")} · ${t("under")} ${thresholds?.nearMeters ?? 200} m`;
    if (rule === "short_duration") return `${t("durationRule")} · ${thresholds?.minMinutes ?? 4}`;
    if (rule === "far_customer") return `${t("customerRule")} · ${t("over")} ${thresholds?.customerFarMeters ?? 500} m`;
    return t("proofMissing");
  }

  return (
    <div className={rosterCanvas}>
      <RosterNav />
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-[#A8321D] text-white">
          <Bell className="size-4" fill="currentColor" strokeWidth={2.5} aria-hidden />
        </span>
        <div>
          <h1 className={rosterH1}>{t("alerts")}</h1>
          <p className={rosterMuted}>{t("alertsLead")}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["today", "yesterday", "last7"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={cn("h-9 rounded-[10px] px-3 text-sm font-semibold", preset === key ? "bg-[#1D1B1A] text-white" : "bg-white text-[#3D3734]")}
            onClick={() => setPreset(key)}
          >
            {t(key)}
          </button>
        ))}
        <SearchSelect
          className="h-9 min-w-[180px]"
          items={[{ value: "all", label: t("allRestaurants") }, ...places.map((place) => ({ value: place.id, label: place.name, keywords: [place.name, place.storeCc] }))]}
          value={restaurantId ?? "all"}
          onChange={(value) => setRestaurantId(!value || value === "all" ? null : value)}
          placeholder={t("allRestaurants")}
          searchPlaceholder={t("restaurant")}
          recentsKey="roster-alert-place"
          clearable={false}
        />
      </div>
      {alerts.data?.failure ? <p className="text-xs text-destructive">{t(`errors.${alerts.data.failure}`)}</p> : null}
      <div className="grid gap-2 sm:grid-cols-4">
        {[
          [t("lateLogins"), lateCount, "bg-[#D97706]"],
          [t("leftEarly"), earlyCount, "bg-[#7A52CC]"],
          [t("statuses.not_logged_in"), noneCount, "bg-[#C8302A]"],
          [t("earlyTab"), dropCount, "bg-[#B42318]"],
        ].map(([label, value, dot]) => (
          <div key={String(label)} className={cn(rosterCard, "p-3")}>
            <p className="flex items-center gap-2 text-xs text-[#5E5754]">
              <span className={cn("size-2 rounded-full", String(dot))} />
              {label}
            </p>
            <p className="text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {(["all", "attendance", "early"] as const).map((key) => {
          const count = key === "all" ? rows.length : key === "attendance" ? rows.filter((row) => ATTENDANCE.has(row.kind)).length : dropCount;
          return (
            <button
              key={key}
              type="button"
              className={cn("h-9 rounded-full px-3 text-sm font-semibold", tab === key ? "bg-[#1D1B1A] text-white" : "bg-white text-[#3D3734]")}
              onClick={() => setTab(key)}
            >
              {key === "all" ? t("all") : key === "attendance" ? t("attendanceTab") : t("earlyTab")} {count}
            </button>
          );
        })}
      </div>
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className={cn(rosterCard, "overflow-x-auto")}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E2DCD8]">
                {[t("time"), t("alertCol"), t("rider"), t("restaurant"), t("details"), t("status")].map((label) => (
                  <th key={label} className={rosterTh}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 200).map((row) => (
                <tr
                  key={row.id}
                  className={cn("cursor-pointer border-b border-[#E2DCD8]", selected === row.id && row.kind === "early_drop" && "bg-[#FFF8F7]", selected === row.id && row.kind !== "early_drop" && "bg-[#F6E9E5]")}
                  onClick={() => setSelected(row.id)}
                >
                  <td className={rosterTd}>{formatKuwaitTime(row.at)}</td>
                  <td className={rosterTd}>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", kindTone(row.kind))}>
                      {t(`statuses.${row.kind === "early_drop" ? "early_drop" : row.kind}` as "statuses.late")}
                    </span>
                  </td>
                  <td className={rosterTd}>
                    <span className="block font-semibold">{row.driverName || row.driverId}</span>
                    <span className="text-[11px] text-[#5E5754]">{row.employeeId ? `#${row.employeeId}` : row.day}</span>
                  </td>
                  <td className={rosterTd}>{row.restaurantName || "—"}</td>
                  <td className={rosterTd}>
                    {row.kind === "early_drop" ? row.restaurantName || "—" : `${t("minutesLate")} ${row.minutesLate} · ${t("minutesEarly")} ${row.minutesEarly}`}
                  </td>
                  <td className={rosterTd}>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", row.acknowledged ? "bg-[#E7F6EE] text-[#146C43]" : "bg-[#FDE7E5] text-[#A3221A]")}>
                      {row.acknowledged ? t("acknowledged") : t("new")}
                    </span>
                    {row.outcome ? <span className="mt-1 block text-[11px] text-[#5E5754]">{outcomeText(row.outcome)}</span> : null}
                    <button type="button" className={cn(rosterBtnSoft, "mt-1 h-8 px-2 text-xs")} onClick={() => setSelected(row.id)}>
                      {t("acknowledge")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 ? <p className="p-3 text-sm text-[#5E5754]">{t("noRows")}</p> : null}
        </div>
        <aside className={cn(rosterCard, "p-4 text-sm")}>
          {current ? (
            <div className="space-y-3">
              <p className="font-semibold">{current.driverName}</p>
              <p className="text-[#5E5754]">{current.employeeId ? `#${current.employeeId}` : current.day} · {current.restaurantName || "—"}</p>
              {current.kind === "early_drop" && detailRow?.delivery ? (
                <p>{t("order")} {detailRow.delivery.orderId || "—"} · {t("pickedUp")} {formatKuwaitDateTime(detailRow.delivery.pickupAt)} · {t("delivered")} {formatKuwaitDateTime(detailRow.delivery.deliveredAt)}</p>
              ) : (
                <p>{t("minutesLate")} {current.minutesLate} · {t("minutesEarly")} {current.minutesEarly}</p>
              )}
              {current.kind === "early_drop" ? (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#5E5754]">{t("hitsOf", { hit: reasons.size, total: RULES.length })}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#5E5754]">{t("rulesChecked")}</p>
                  <ul className="space-y-1">
                    {RULES.map((rule) => (
                      <li key={rule} className={reasons.has(rule) ? "font-semibold text-[#B42318]" : "text-[#5E5754]"}>
                        <span className={cn("me-1 inline-block size-2 rounded-full", reasons.has(rule) ? "bg-[#B42318]" : "bg-[#C8C0BB]")} /> {ruleText(rule)}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#5E5754]">{t("gpsAudit")}</p>
                  <p>
                    <span className={reasons.size > 0 ? "text-[#5E5754] line-through" : ""}>{t("coordsMatch")}</span>
                    {reasons.size > 0 ? <span className="ms-2 font-semibold text-[#B42318]">{t("statuses.early_drop")}</span> : null}
                  </p>
                  <p className="text-xs text-[#5E5754]">{detailRow && "missingProof" in detailRow && detailRow.missingProof ? t("proofMissing") : t("proofPresent")}</p>
                </>
              ) : null}
              <label className="block text-xs text-[#5E5754]">
                {t("outcome")}
                <select className="mt-1 h-9 w-full rounded-[10px] border border-[#E2DCD8] bg-white px-2 text-sm text-[#1D1B1A]" value={outcome} onChange={(event) => setOutcome(event.target.value as OutcomeKey | "")}>
                  <option value="">{t("chooseOutcome")}</option>
                  {OUTCOMES.map((key) => (
                    <option key={key} value={key}>{t(key)}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={rosterBtn}
                disabled={!outcome}
                onClick={() => {
                  if (!outcome) return;
                  void ackRosterAlert(current.id, outcome).then(() => client.invalidateQueries({ queryKey: ["roster", "alerts"] }));
                }}
              >
                {t("saveOutcome")}
              </button>
              <Link href={`/live-tracking-v2?driver=${current.driverId}`} className={rosterBtnSoft}>{t("showOnMap")}</Link>
            </div>
          ) : (
            <p className="text-[#5E5754]">{t("noRows")}</p>
          )}
        </aside>
      </div>
      <p className="text-[10px] text-[#5E5754]">{t("sentToCoaches")}</p>
    </div>
  );
}
