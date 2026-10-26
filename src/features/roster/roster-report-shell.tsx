"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { downloadWorkbookXlsx } from "@/features/drivers/import/export-xlsx";
import { kuwaitToday, addDays } from "@/features/driver-tracking/kuwait-time";
import { fetchRosterReport } from "./roster-actions";
import { rosterError } from "./roster-result";

export function RosterReportShell() {
  const t = useTranslations("pages.roster");
  const today = kuwaitToday();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [zone, setZone] = useState("");
  const [restaurant, setRestaurant] = useState("");
  const [company, setCompany] = useState("");
  const [rider, setRider] = useState("");
  const [run, setRun] = useState(0);

  const query = useQuery({
    queryKey: ["roster", "report", from, to, zone, restaurant, company, rider, run],
    queryFn: () =>
      fetchRosterReport({
        from,
        to,
        zoneId: zone.trim() || null,
        restaurantId: restaurant.trim() || null,
        company: company.trim() || null,
        driverId: rider.trim() || null,
      }),
    enabled: run > 0,
  });
  const data = query.data;
  const rows = data && "rows" in data ? data.rows : [];
  const failure = rosterError(data);
  const late = rows.filter((row) => row.status === "late").length;
  const early = rows.filter((row) => row.status === "logged_out_early").length;
  const noShow = rows.filter((row) => row.status === "no_show").length;
  const drops = rows.reduce((sum, row) => sum + row.earlyDrops.length, 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="type-h1">{t("report")}</h1>
        <Button variant="outline" className="h-9" nativeButton={false} render={<Link href="/operations/roster" />}>
          {t("schedule")}
        </Button>
      </div>
      <div className="grid gap-2 rounded-xl border border-border bg-card p-4 shadow-sm md:grid-cols-4">
        <label className="space-y-1 text-xs">
          {t("from")}
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9" />
        </label>
        <label className="space-y-1 text-xs">
          {t("to")}
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9" />
        </label>
        <label className="space-y-1 text-xs">
          {t("zone")}
          <Input value={zone} onChange={(event) => setZone(event.target.value)} className="h-9" placeholder={t("zone")} />
        </label>
        <label className="space-y-1 text-xs">
          {t("restaurant")}
          <Input value={restaurant} onChange={(event) => setRestaurant(event.target.value)} className="h-9" placeholder={t("restaurant")} />
        </label>
        <label className="space-y-1 text-xs">
          {t("company")}
          <Input value={company} onChange={(event) => setCompany(event.target.value)} className="h-9" placeholder={t("company")} />
        </label>
        <label className="space-y-1 text-xs">
          {t("rider")}
          <Input value={rider} onChange={(event) => setRider(event.target.value)} className="h-9" placeholder={t("rider")} />
        </label>
        <div className="flex items-end gap-2 md:col-span-2">
          <Button className="h-9" onClick={() => setRun((value) => value + 1)}>
            {t("preview")}
          </Button>
          <Button
            variant="outline"
            className="h-9"
            disabled={rows.length === 0}
            onClick={() =>
              downloadWorkbookXlsx("roster-report.xlsx", [
                {
                  name: "Report",
                  aoa: [
                    ["Employee", "Name", "Date", "Restaurant", "Zone", "Company", "Start", "End", "In", "Out", "Status", "Late", "Early", "Early drops"],
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
                      row.earlyDrops.map((drop) => drop.deliveryId).join(", "),
                    ]),
                  ],
                },
              ])
            }
          >
            {t("export")}
          </Button>
        </div>
      </div>
      {failure ? <p className="text-xs text-destructive">{t(`errors.${failure}`)}</p> : null}
      <p className="text-xs text-muted-foreground">
        {rows.length} · {t("statuses.late")} {late} · {t("statuses.logged_out_early")} {early} · {t("statuses.no_show")} {noShow} · {t("statuses.early_drop")} {drops}
      </p>
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-start">
              {[t("rider"), t("from"), t("restaurant"), t("zone"), t("schedule"), t("status"), t("statuses.early_drop")].map((label) => (
                <th key={label} className="px-2 py-2 font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-2 py-3 text-muted-foreground" colSpan={7}>
                  {t("noRows")}
                </td>
              </tr>
            ) : (
              rows.slice(0, 200).map((row) => (
                <tr key={`${row.driverId}-${row.date}`} className="border-b">
                  <td className="px-2 py-1">{row.employeeId} {row.driverName}</td>
                  <td className="px-2 py-1">{row.date}</td>
                  <td className="px-2 py-1">{row.restaurantName}</td>
                  <td className="px-2 py-1">{row.zoneName}</td>
                  <td className="px-2 py-1">{row.scheduledStart ?? "—"}–{row.scheduledEnd ?? "—"}</td>
                  <td className="px-2 py-1">{t(`statuses.${row.status}`)}</td>
                  <td className="px-2 py-1">{row.earlyDrops.length}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
