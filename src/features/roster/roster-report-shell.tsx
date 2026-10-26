"use client";

import { useQuery } from "@tanstack/react-query";
import { FileBarChart } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { addDays, kuwaitToday } from "@/features/driver-tracking/kuwait-time";
import { formatKuwaitTime } from "@/features/driver-tracking/shift-adherence-display";
import { downloadWorkbookXlsx } from "@/features/drivers/import/export-xlsx";
import { formatPct } from "@/lib/format/percent";
import { cn } from "@/lib/utils";
import { fetchRosterDirectory, fetchRosterReport } from "./roster-actions";
import { RosterNav } from "./roster-nav";
import { rosterError } from "./roster-result";
import { rosterBtn, rosterCanvas, rosterCard, rosterH1, rosterMuted, rosterTd, rosterTh } from "./roster-ui";

function hours(minutes: number) {
  return (minutes / 60).toFixed(1);
}

type GroupKey = "driverName" | "restaurantName" | "zoneName";

export function RosterReportShell() {
  const t = useTranslations("pages.roster");
  const today = kuwaitToday();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [tab, setTab] = useState<"shifts" | "drops" | "totals">("shifts");
  const [group, setGroup] = useState<GroupKey>("driverName");
  const directory = useQuery({ queryKey: ["roster", "directory"], queryFn: fetchRosterDirectory });
  const report = useQuery({
    queryKey: ["roster", "report", from, to, zoneId, restaurantId, company, driverId],
    queryFn: () => fetchRosterReport({ from, to, zoneId, restaurantId, company, driverId }),
  });
  const rows = report.data && "rows" in report.data && Array.isArray(report.data.rows) ? report.data.rows : [];
  const failure = rosterError(report.data);
  const zones = directory.data && "zones" in directory.data ? directory.data.zones : [];
  const places = directory.data && "restaurants" in directory.data ? directory.data.restaurants : [];
  const companies = directory.data && "companies" in directory.data ? directory.data.companies : [];
  const riders = directory.data && "riders" in directory.data ? directory.data.riders : [];
  const scheduled = rows.reduce((sum, row) => sum + row.scheduledMinutes, 0);
  const worked = rows.reduce((sum, row) => sum + row.workedMinutes, 0);
  const late = rows.filter((row) => row.status === "late").length;
  const early = rows.filter((row) => row.status === "logged_out_early").length;
  const noShow = rows.filter((row) => row.status === "no_show").length;
  const drops = rows.reduce((sum, row) => sum + row.earlyDrops.length, 0);

  function totals(key: GroupKey) {
    const map = new Map<string, { count: number; scheduled: number; worked: number; late: number; early: number; noShow: number; drops: number }>();
    for (const row of rows) {
      const name = row[key] || "—";
      const current = map.get(name) ?? { count: 0, scheduled: 0, worked: 0, late: 0, early: 0, noShow: 0, drops: 0 };
      current.count += 1;
      current.scheduled += row.scheduledMinutes;
      current.worked += row.workedMinutes;
      if (row.status === "late") current.late += 1;
      if (row.status === "logged_out_early") current.early += 1;
      if (row.status === "no_show") current.noShow += 1;
      current.drops += row.earlyDrops.length;
      map.set(name, current);
    }
    return [...map.entries()];
  }

  const grouped = totals(group);

  return (
    <div className={rosterCanvas}>
      <RosterNav />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-[#A8321D] text-white">
            <FileBarChart className="size-4" fill="currentColor" strokeWidth={2.5} aria-hidden />
          </span>
          <div>
            <h1 className={rosterH1}>{t("reportTitle")}</h1>
            <p className={rosterMuted}>{t("reportLead")}</p>
          </div>
        </div>
        <button
          type="button"
          className={rosterBtn}
          disabled={rows.length === 0}
          onClick={() =>
            downloadWorkbookXlsx("roster-report.xlsx", [
              {
                name: "Report",
                aoa: [
                  ["Employee", "Name", "Date", "Restaurant", "Zone", "Company", "Start", "End", "In", "Out", "Status", "Late", "Early", "Scheduled hours", "Worked hours", "Approved by", "Early drops"],
                  ...rows.map((row) => [
                    row.employeeId,
                    row.driverName,
                    row.date,
                    row.restaurantName,
                    row.zoneName,
                    row.company,
                    row.scheduledStart ?? "",
                    row.scheduledEnd ?? "",
                    row.actualIn ?? "",
                    row.actualOut ?? "",
                    row.status,
                    row.minutesLate,
                    row.minutesEarly,
                    hours(row.scheduledMinutes),
                    hours(row.workedMinutes),
                    row.changeApprovedBy ?? "",
                    row.earlyDrops.map((drop) => drop.deliveryId).join(", "),
                  ]),
                ],
              },
            ])
          }
        >
          {t("export")}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[#5E5754]">{t("dateRange")}</span>
        <Input className="h-9 w-36" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input className="h-9 w-36" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <SearchSelect className="h-9 min-w-[140px]" items={[{ value: "all", label: t("allZones") }, ...zones.map((zone) => ({ value: zone.id, label: zone.name, keywords: [zone.name] }))]} value={zoneId ?? "all"} onChange={(value) => setZoneId(!value || value === "all" ? null : value)} placeholder={t("allZones")} searchPlaceholder={t("zone")} recentsKey="roster-report-zone" clearable={false} />
        <SearchSelect className="h-9 min-w-[160px]" items={[{ value: "all", label: t("allRestaurants") }, ...places.map((place) => ({ value: place.id, label: place.name, keywords: [place.name, place.storeCc] }))]} value={restaurantId ?? "all"} onChange={(value) => setRestaurantId(!value || value === "all" ? null : value)} placeholder={t("allRestaurants")} searchPlaceholder={t("restaurant")} recentsKey="roster-report-place" clearable={false} />
        <SearchSelect className="h-9 min-w-[140px]" items={[{ value: "all", label: t("allCompanies") }, ...companies.map((name) => ({ value: name, label: name, keywords: [name] }))]} value={company ?? "all"} onChange={(value) => setCompany(!value || value === "all" ? null : value)} placeholder={t("allCompanies")} searchPlaceholder={t("company")} recentsKey="roster-report-company" clearable={false} />
        <SearchSelect className="h-9 min-w-[180px]" items={[{ value: "all", label: t("all") }, ...riders.map((rider) => ({ value: rider.id, label: `${rider.employeeId} ${rider.name}`, keywords: [rider.name, rider.employeeId] }))]} value={driverId ?? "all"} onChange={(value) => setDriverId(!value || value === "all" ? null : value)} placeholder={t("rider")} searchPlaceholder={t("searchRider")} recentsKey="roster-report-rider" clearable={false} />
      </div>
      {failure ? <p className="text-xs text-destructive">{t(`errors.${failure}`)}</p> : null}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          [t("scheduledHours"), hours(scheduled)],
          [t("workedHours"), hours(worked)],
          [t("statuses.late"), late],
          [t("leftEarly"), early],
          [t("statuses.no_show"), noShow],
          [t("statuses.early_drop"), drops],
        ].map(([label, value]) => (
          <div key={String(label)} className={cn(rosterCard, "p-3")}>
            <p className="text-xs text-[#5E5754]">{label}</p>
            <p className="text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {(["shifts", "drops", "totals"] as const).map((key) => (
          <button key={key} type="button" className={cn("h-9 rounded-full px-3 text-sm font-semibold", tab === key ? "bg-[#1D1B1A] text-white" : "bg-white text-[#3D3734]")} onClick={() => setTab(key)}>
            {key === "shifts" ? t("schedule") : key === "drops" ? t("earlyTab") : t("totals")}
          </button>
        ))}
      </div>
      {tab === "shifts" ? (
        <div className={cn(rosterCard, "overflow-x-auto")}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E2DCD8]">
                {[t("date"), t("rider"), t("restaurant"), t("shiftCol"), t("scheduledHours"), t("actualWindow"), t("minLate"), t("minLeft"), t("result"), t("approvedBy")].map((label) => (
                  <th key={label} className={rosterTh}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((row) => (
                <tr key={`${row.driverId}-${row.date}`} className="border-b border-[#E2DCD8]">
                  <td className={rosterTd}>{row.date}</td>
                  <td className={rosterTd}>{row.employeeId} {row.driverName}</td>
                  <td className={rosterTd}>{row.restaurantName || "—"}</td>
                  <td className={rosterTd}>{row.off ? t("offDay") : `${row.scheduledStart ?? "—"}–${row.scheduledEnd ?? "—"}`}</td>
                  <td className={rosterTd}>{hours(row.scheduledMinutes)}</td>
                  <td className={rosterTd}>{formatKuwaitTime(row.actualIn)}–{formatKuwaitTime(row.actualOut)}</td>
                  <td className={rosterTd}>{row.minutesLate}</td>
                  <td className={rosterTd}>{row.minutesEarly}</td>
                  <td className={rosterTd}>{t(`statuses.${row.status}`)}</td>
                  <td className={rosterTd}>{row.changeApprovedBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {tab === "drops" ? (
        <div className={cn(rosterCard, "overflow-x-auto")}>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E2DCD8]">
                {[t("date"), t("order"), t("rider"), t("restaurant"), t("pickedUp"), t("delivered"), t("fromRestaurant"), t("pickupProof"), t("rulesHit")].map((label) => (
                  <th key={label} className={rosterTh}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((row) => row.earlyDrops.map((drop) => (
                <tr key={drop.deliveryId} className="border-b border-[#E2DCD8]">
                  <td className={rosterTd}>{row.date}</td>
                  <td className={rosterTd}>{drop.orderId || drop.deliveryId}</td>
                  <td className={rosterTd}>{row.driverName}</td>
                  <td className={rosterTd}>{row.restaurantName || "—"}</td>
                  <td className={rosterTd}>{formatKuwaitTime(drop.pickupAt)}</td>
                  <td className={rosterTd}>{formatKuwaitTime(drop.deliveredAt)}</td>
                  <td className={rosterTd}>—</td>
                  <td className={rosterTd}>—</td>
                  <td className={rosterTd}>—</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      ) : null}
      {tab === "totals" ? (
        <div className="space-y-2">
          <div className="flex gap-1">
            {(["driverName", "restaurantName", "zoneName"] as const).map((key) => (
              <button key={key} type="button" className={cn("h-9 rounded-full px-3 text-sm font-semibold", group === key ? "bg-[#1D1B1A] text-white" : "bg-white text-[#3D3734]")} onClick={() => setGroup(key)}>
                {key === "driverName" ? t("groupRider") : key === "restaurantName" ? t("groupRestaurant") : t("groupZone")}
              </button>
            ))}
          </div>
          <div className={cn(rosterCard, "overflow-x-auto")}>
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E2DCD8]">
                  {[t("rider"), t("rowsRead"), t("scheduledHours"), t("workedHours"), t("workedPct"), t("statuses.late"), t("leftEarly"), t("statuses.no_show"), t("earlyTab")].map((label) => (
                    <th key={label} className={rosterTh}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped.slice(0, 80).map(([name, bucket]) => (
                  <tr key={name} className="border-b border-[#E2DCD8]">
                    <td className={rosterTd}>{name}</td>
                    <td className={rosterTd}>{bucket.count}</td>
                    <td className={rosterTd}>{hours(bucket.scheduled)}</td>
                    <td className={rosterTd}>{hours(bucket.worked)}</td>
                    <td className={rosterTd}>{bucket.scheduled > 0 ? formatPct((bucket.worked / bucket.scheduled) * 100) : "—"}</td>
                    <td className={rosterTd}>{bucket.late}</td>
                    <td className={rosterTd}>{bucket.early}</td>
                    <td className={rosterTd}>{bucket.noShow}</td>
                    <td className={rosterTd}>{bucket.drops}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <p className="text-[10px] text-[#5E5754]">{t("workedInside")}</p>
    </div>
  );
}
