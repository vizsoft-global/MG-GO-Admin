"use client";

import { useQuery } from "@tanstack/react-query";
import { FileBarChart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { TableNameCell, useTablePrefs, type TableToolbarColumn } from "@/components/app/table-toolbar";
import { ListToolbar, rowMatches } from "@/features/roster/table-kit";
import { SearchSelect } from "@/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { kuwaitToday } from "@/features/driver-tracking/kuwait-time";
import { formatKuwaitTime } from "@/features/driver-tracking/shift-adherence-display";
import { downloadWorkbookXlsx } from "@/features/drivers/import/export-xlsx";
import { formatPct } from "@/lib/format/percent";
import { selectOptions } from "@/lib/select-items";
import { cn } from "@/lib/utils";
import type { RosterDutyStatus } from "./roster-adherence";
import { fetchRosterDirectory, fetchRosterReport, loadRosterThresholds } from "./roster-actions";
import { RosterField } from "./roster-field";
import { RosterNav } from "./roster-nav";
import { clock12, formatDayLabel, formatRangeLabel, rangeForPreset, type RosterRangePreset } from "./roster-range";
import { rosterError } from "./roster-result";
import { rosterBtn, rosterCanvas, rosterCard, rosterH1, rosterMuted, rosterTd, rosterTh } from "./roster-ui";

function hours(minutes: number) {
  return (minutes / 60).toFixed(1);
}

type GroupKey = "driverName" | "restaurantName" | "zoneName";

function resultTone(status: RosterDutyStatus): string {
  switch (status) {
    case "late":
      return "bg-[#FDF0DC] text-[#8A4B06]";
    case "on_shift":
    case "scheduled":
      return "bg-[#E7F6EE] text-[#146C43]";
    case "logged_out_early":
      return "bg-[#EEE8FB] text-[#5B34A8]";
    case "no_show":
    case "not_logged_in":
      return "bg-[#F3F0EE] text-[#5E5754]";
    case "off":
      return "bg-[#F3F0EE] text-[#5E5754]";
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

export function RosterReportShell() {
  const t = useTranslations("pages.roster");
  const shiftColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "date", label: t("date") },
      { id: "rider", label: t("rider"), locked: true },
      { id: "restaurant", label: t("restaurant") },
      { id: "shift", label: t("shiftCol") },
      { id: "scheduled", label: t("scheduledHours") },
      { id: "actual", label: t("actualWindow") },
      { id: "late", label: t("minLate") },
      { id: "left", label: t("minLeft") },
      { id: "result", label: t("result") },
    ],
    [t],
  );
  const dropColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "date", label: t("date") },
      { id: "order", label: t("order"), locked: true },
      { id: "rider", label: t("rider"), locked: true },
      { id: "restaurant", label: t("restaurant") },
      { id: "picked", label: t("pickedUp") },
      { id: "delivered", label: t("delivered") },
      { id: "from", label: t("fromRestaurant") },
      { id: "proof", label: t("pickupProof") },
      { id: "rules", label: t("rulesHit") },
    ],
    [t],
  );
  const totalColumns = useMemo<TableToolbarColumn[]>(
    () => [
      { id: "name", label: t("rider"), locked: true },
      { id: "rows", label: t("rowsRead") },
      { id: "scheduled", label: t("scheduledHours") },
      { id: "worked", label: t("workedHours") },
      { id: "pct", label: t("workedPct") },
      { id: "late", label: t("statuses.late") },
      { id: "early", label: t("leftEarly") },
      { id: "noshow", label: t("statuses.no_show") },
      { id: "drop", label: t("earlyTab") },
    ],
    [t],
  );
  const shiftPrefs = useTablePrefs("roster.reportShifts", shiftColumns);
  const dropPrefs = useTablePrefs("roster.reportDrops", dropColumns);
  const totalPrefs = useTablePrefs("roster.reportTotals", totalColumns);
  const locale = useLocale();
  const today = kuwaitToday();
  const lastWeek = rangeForPreset("lastWeek", today);
  const [preset, setPreset] = useState<RosterRangePreset>("lastWeek");
  const [from, setFrom] = useState(lastWeek.from);
  const [to, setTo] = useState(lastWeek.to);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [tab, setTab] = useState<"shifts" | "drops" | "totals">("shifts");
  const [group, setGroup] = useState<GroupKey>("driverName");
  const directory = useQuery({ queryKey: ["roster", "directory"], queryFn: fetchRosterDirectory });
  const settings = useQuery({ queryKey: ["roster", "settings"], queryFn: loadRosterThresholds });
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
  const thresholds = settings.data && "lateGraceMinutes" in settings.data ? settings.data : null;
  const scheduled = rows.reduce((sum, row) => sum + row.scheduledMinutes, 0);
  const worked = rows.reduce((sum, row) => sum + row.workedMinutes, 0);
  const late = rows.filter((row) => row.status === "late").length;
  const early = rows.filter((row) => row.status === "logged_out_early").length;
  const noShow = rows.filter((row) => row.status === "no_show").length;
  const drops = rows.reduce((sum, row) => sum + row.earlyDrops.length, 0);
  const riderCount = new Set(rows.map((row) => row.driverId)).size;
  const restCount = new Set(rows.map((row) => row.restaurantId).filter(Boolean)).size;

  useEffect(() => {
    if (zoneId) return;
    if (zones.length === 1) setZoneId(zones[0].id);
  }, [zones, zoneId]);

  const rangeItems = useMemo(() => {
    const last = rangeForPreset("lastWeek", today);
    const current = rangeForPreset("thisWeek", today);
    return selectOptions([
      { value: "lastWeek", label: `${t("lastWeek")} · ${formatRangeLabel(last.from, last.to, locale)}` },
      { value: "thisWeek", label: `${t("thisWeek")} · ${formatRangeLabel(current.from, current.to, locale)}` },
      { value: "last7", label: t("last7") },
      { value: "today", label: t("today") },
      { value: "yesterday", label: t("yesterday") },
      { value: "custom", label: t("custom") },
    ]);
  }, [locale, t, today]);

  function pickPreset(next: string | null) {
    switch (next) {
      case "today":
      case "yesterday":
      case "last7":
      case "thisWeek":
      case "lastWeek":
      case "custom":
        setPreset(next);
        if (next !== "custom") {
          const range = rangeForPreset(next, today);
          setFrom(range.from);
          setTo(range.to);
        }
        return;
      default:
        return;
    }
  }

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
  const zoneItems = zones.map((zone) => ({
    value: zone.id,
    label: zones.length === 1 ? t("yourZone", { name: zone.name }) : zone.name,
    keywords: [zone.name],
  }));

  function resultLabel(status: RosterDutyStatus) {
    if (status === "on_shift") return t("onTime");
    return t(`statuses.${status}`);
  }

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
      <div className={cn(rosterCard, "flex flex-nowrap items-end gap-2 overflow-x-auto p-3")}>
        <RosterField label={t("dateRange")} className="min-w-[220px]">
          <Select items={rangeItems} value={preset} onValueChange={pickPreset}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {rangeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </RosterField>
        {preset === "custom" ? (
          <>
            <RosterField label={t("from")} className="min-w-[140px] flex-none">
              <Input className="h-9" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </RosterField>
            <RosterField label={t("to")} className="min-w-[140px] flex-none">
              <Input className="h-9" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </RosterField>
          </>
        ) : null}
        <RosterField label={t("zone")}>
          <SearchSelect className="h-9 min-w-[140px]" items={[{ value: "all", label: t("allZones") }, ...zoneItems]} value={zoneId ?? "all"} onChange={(value) => setZoneId(!value || value === "all" ? null : value)} placeholder={t("allZones")} searchPlaceholder={t("zone")} recentsKey="roster-report-zone" clearable={false} />
        </RosterField>
        <RosterField label={t("restaurant")}>
          <SearchSelect className="h-9 min-w-[160px]" items={[{ value: "all", label: t("allRestaurants") }, ...places.map((place) => ({ value: place.id, label: place.name, keywords: [place.name, place.storeCc] }))]} value={restaurantId ?? "all"} onChange={(value) => setRestaurantId(!value || value === "all" ? null : value)} placeholder={t("allRestaurants")} searchPlaceholder={t("restaurant")} recentsKey="roster-report-place" clearable={false} />
        </RosterField>
        <RosterField label={t("company")}>
          <SearchSelect className="h-9 min-w-[140px]" items={[{ value: "all", label: t("allCompanies") }, ...companies.map((name) => ({ value: name, label: name, keywords: [name] }))]} value={company ?? "all"} onChange={(value) => setCompany(!value || value === "all" ? null : value)} placeholder={t("allCompanies")} searchPlaceholder={t("company")} recentsKey="roster-report-company" clearable={false} />
        </RosterField>
        <RosterField label={t("rider")}>
          <SearchSelect className="h-9 min-w-[180px]" items={[{ value: "all", label: t("all") }, ...riders.map((rider) => ({ value: rider.id, label: `${rider.name} #${rider.employeeId}`, keywords: [rider.name, rider.employeeId] }))]} value={driverId ?? "all"} onChange={(value) => setDriverId(!value || value === "all" ? null : value)} placeholder={t("nameOrId")} searchPlaceholder={t("nameOrId")} recentsKey="roster-report-rider" clearable={false} />
        </RosterField>
      </div>
      {failure ? <p className="text-xs text-destructive">{t(`errors.${failure}`)}</p> : null}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: t("scheduledHours"), value: hours(scheduled), hint: t("scheduledRiders", { riders: riderCount, restaurants: restCount }) },
          { label: t("workedHours"), value: hours(worked), hint: t("workedOfScheduled", { pct: scheduled > 0 ? formatPct((worked / scheduled) * 100) : "—" }) },
          { label: t("statuses.late"), value: late, hint: t("afterGrace", { minutes: thresholds?.lateGraceMinutes ?? 15 }) },
          { label: t("leftEarly"), value: early, hint: t("beforeGrace", { minutes: thresholds?.earlyGraceMinutes ?? 10 }) },
          { label: t("statuses.no_show"), value: noShow, hint: t("noLoginWithin", { minutes: thresholds?.noLoginGraceMinutes ?? 60 }) },
          { label: t("statuses.early_drop"), value: drops, hint: "" },
        ].map((card) => (
          <div key={card.label} className={cn(rosterCard, "p-3")}>
            <p className="text-xs text-[#5E5754]">{card.label}</p>
            <p className="text-xl font-semibold">{card.value}</p>
            {card.hint ? <p className="text-[10px] text-[#5E5754]">{card.hint}</p> : null}
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
          <ListToolbar prefs={shiftPrefs} entity={t("rider")} columns={shiftColumns} rowKind="dynamic" filteredCount={rows.filter((row) => rowMatches(shiftPrefs.appliedQuery, [row.driverName, row.employeeId, row.restaurantName, row.status])).length} totalCount={rows.length} />
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E2DCD8]">
                {[t("date"), t("rider"), t("restaurant"), t("shiftCol"), t("scheduledHours"), t("actualWindow"), t("minLate"), t("minLeft"), t("result")].map((label) => (
                  <th key={label} className={rosterTh}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.filter((row) => rowMatches(shiftPrefs.appliedQuery, [row.driverName, row.employeeId, row.restaurantName, row.status])).slice(0, 200).map((row) => (
                <tr key={`${row.driverId}-${row.date}`} className="border-b border-[#E2DCD8]">
                  <td className={rosterTd}>{formatDayLabel(row.date, locale)}</td>
                  <td className={rosterTd}><TableNameCell name={row.driverName} /> {row.employeeId ? `#${row.employeeId}` : ""}</td>
                  <td className={rosterTd}>{row.restaurantName || "—"}</td>
                  <td className={rosterTd}>{row.off ? t("offDay") : "1 of 1"}</td>
                  <td className={rosterTd}>{row.off ? "—" : `${clock12(row.scheduledStart)} – ${clock12(row.scheduledEnd)}`}</td>
                  <td className={rosterTd}>{row.actualIn || row.actualOut ? `${formatKuwaitTime(row.actualIn)} – ${formatKuwaitTime(row.actualOut)}` : t("noLogin")}</td>
                  <td className={rosterTd}>{row.minutesLate || "—"}</td>
                  <td className={rosterTd}>{row.minutesEarly || "—"}</td>
                  <td className={rosterTd}>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", resultTone(row.status))}>{resultLabel(row.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {tab === "drops" ? (
        <div className={cn(rosterCard, "overflow-x-auto")}>
          <ListToolbar prefs={dropPrefs} entity={t("order")} columns={dropColumns} rowKind="dynamic" filteredCount={rows.filter((row) => row.earlyDrops.some((drop) => rowMatches(dropPrefs.appliedQuery, [row.driverName, row.restaurantName, drop.orderId]))).length} totalCount={rows.length} />
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E2DCD8]">
                {[t("date"), t("order"), t("rider"), t("restaurant"), t("pickedUp"), t("delivered"), t("fromRestaurant"), t("pickupProof"), t("rulesHit")].map((label) => (
                  <th key={label} className={rosterTh}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.filter((row) => row.earlyDrops.some((drop) => rowMatches(dropPrefs.appliedQuery, [row.driverName, row.restaurantName, drop.orderId]))).flatMap((row) => row.earlyDrops.filter((drop) => rowMatches(dropPrefs.appliedQuery, [row.driverName, row.restaurantName, drop.orderId])).map((drop) => (
                <tr key={drop.deliveryId} className="border-b border-[#E2DCD8]">
                  <td className={rosterTd}>{formatDayLabel(row.date, locale)}</td>
                  <td className={rosterTd}>{drop.orderId || drop.deliveryId}</td>
                  <td className={rosterTd}><TableNameCell name={row.driverName} /></td>
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
            <ListToolbar prefs={totalPrefs} entity={t("rider")} columns={totalColumns} rowKind="aggregate" filteredCount={grouped.filter(([name]) => rowMatches(totalPrefs.appliedQuery, [name])).length} totalCount={grouped.length} />
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E2DCD8]">
                  {[t("rider"), t("rowsRead"), t("scheduledHours"), t("workedHours"), t("workedPct"), t("statuses.late"), t("leftEarly"), t("statuses.no_show"), t("earlyTab")].map((label) => (
                    <th key={label} className={rosterTh}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped.filter(([name]) => rowMatches(totalPrefs.appliedQuery, [name])).slice(0, 80).map(([name, bucket]) => (
                  <tr key={name} className="border-b border-[#E2DCD8]">
                    <td className={rosterTd}><TableNameCell name={name} /></td>
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
