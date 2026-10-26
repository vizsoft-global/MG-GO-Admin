"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { decideRosterChange, fetchDriverRosterWeek, fetchRosterChanges, fetchRosterDirectory, requestRosterChange } from "./roster-actions";
import { RosterNav } from "./roster-nav";
import { rosterError } from "./roster-result";
import { rosterBtn, rosterBtnSoft, rosterCanvas, rosterCard, rosterH1, rosterMuted } from "./roster-ui";

type ChangeKind = "times" | "off" | "place";
type ChangeTab = "all" | "waiting" | "approved" | "rejected";

export function RosterChangesShell() {
  const t = useTranslations("pages.roster");
  const client = useQueryClient();
  const { can, isManager, isSuperAdmin } = useAuth();
  const canDecide = isManager || isSuperAdmin || can("attendance.manage");
  const changes = useQuery({ queryKey: ["roster", "changes"], queryFn: fetchRosterChanges });
  const directory = useQuery({ queryKey: ["roster", "directory"], queryFn: fetchRosterDirectory });
  const rows = changes.data && "rows" in changes.data && Array.isArray(changes.data.rows) ? changes.data.rows : [];
  const riders = directory.data && "riders" in directory.data ? directory.data.riders : [];
  const places = directory.data && "restaurants" in directory.data ? directory.data.restaurants : [];
  const zones = directory.data && "zones" in directory.data ? directory.data.zones : [];
  const [tab, setTab] = useState<ChangeTab>("waiting");
  const [driverId, setDriverId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<ChangeKind>("times");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [endsNext, setEndsNext] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const shown = tab === "all" ? rows : rows.filter((row) => row.status === tab);

  function zoneName(id: string | null) {
    return zones.find((zone) => zone.id === id)?.name ?? "";
  }

  function windowText(off: boolean, startAt: string | null, endAt: string | null) {
    return off ? t("offDay") : `${startAt ?? "—"}–${endAt ?? "—"}`;
  }

  async function submit() {
    const rider = riders.find((row) => row.id === driverId);
    const place = places.find((row) => row.id === restaurantId);
    if (!rider || !date) return;
    const week = await fetchDriverRosterWeek(rider.id);
    const day = week && "days" in week ? week.days.find((row) => row.date === date) : undefined;
    const off = kind === "off";
    const result = await requestRosterChange({
      driverId: rider.id,
      driverName: rider.name,
      employeeId: rider.employeeId,
      date,
      beforeStart: day?.originalStart || day?.start || null,
      beforeEnd: day?.originalEnd || day?.end || null,
      beforeOff: day?.off ?? false,
      beforeRestaurantId: null,
      afterStart: off ? null : start || null,
      afterEnd: off ? null : end || null,
      afterOff: off,
      afterRestaurantId: kind === "place" ? restaurantId : null,
      restaurantName: kind === "place" ? place?.name ?? "" : "",
      zoneId: kind === "place" ? place?.zoneId ?? null : null,
      endsNextDay: kind === "times" && endsNext,
      reason,
    });
    const code = rosterError(result);
    setNote(code ? t(`errors.${code}`) : t("waitingApproval"));
    void client.invalidateQueries({ queryKey: ["roster", "changes"] });
  }

  return (
    <div className={rosterCanvas}>
      <RosterNav />
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-[#A8321D] text-white">
          <CalendarClock className="size-4" fill="currentColor" strokeWidth={2.5} aria-hidden />
        </span>
        <div>
          <h1 className={rosterH1}>{t("navChanges")}</h1>
          <p className={rosterMuted}>{t("changesLead")}</p>
        </div>
      </div>
      {note ? <p className="text-sm text-[#5E5754]">{note}</p> : null}
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className={cn(rosterCard, "p-3")}>
          <div className="flex flex-wrap gap-1">
            {(["waiting", "approved", "rejected", "all"] as const).map((key) => {
              const count = key === "all" ? rows.length : rows.filter((row) => row.status === key).length;
              return (
                <button key={key} type="button" className={cn("h-9 rounded-full px-3 text-sm font-semibold", tab === key ? "bg-[#1D1B1A] text-white" : "bg-[#F3F0EE] text-[#3D3734]")} onClick={() => setTab(key)}>
                  {key === "all" ? t("all") : t(`changeStatus.${key}`)} {count}
                </button>
              );
            })}
          </div>
          <div className="mt-2 space-y-2">
            {shown.map((row) => {
              const place = [row.restaurantName, zoneName(row.zoneId)].filter(Boolean).join(" · ");
              return (
                <article key={row.id} className="rounded-[10px] border border-[#E2DCD8] p-3 text-sm">
                  <p className="font-semibold">{row.driverName} <span className="text-[#5E5754]">#{row.employeeId}</span></p>
                  <p className="text-[#5E5754]">{place || "—"} · {row.date}</p>
                  <p className="mt-1">{windowText(row.beforeOff, row.beforeStart, row.beforeEnd)} → {windowText(row.afterOff, row.afterStart, row.afterEnd)}</p>
                  {row.reason ? <p className="text-[#5E5754]">{row.reason}</p> : null}
                  <p className="text-xs text-[#5E5754]">{t("requestedBy")} {row.requestedByName}{row.decidedByName ? ` · ${row.decidedByName}` : ""}</p>
                  {canDecide && row.status === "waiting" ? (
                    <div className="mt-2 flex gap-2">
                      <button type="button" className={rosterBtn} onClick={() => void decideRosterChange(row.id, "approved").then(() => client.invalidateQueries({ queryKey: ["roster", "changes"] }))}>{t("approve")}</button>
                      <button type="button" className={rosterBtnSoft} onClick={() => void decideRosterChange(row.id, "rejected").then(() => client.invalidateQueries({ queryKey: ["roster", "changes"] }))}>{t("reject")}</button>
                    </div>
                  ) : null}
                </article>
              );
            })}
            {shown.length === 0 ? <p className="text-sm text-[#5E5754]">{t("noRows")}</p> : null}
          </div>
        </section>
        <aside className={cn(rosterCard, "space-y-2 p-4")}>
          <h2 className="text-sm font-semibold">{t("requestChange")}</h2>
          <SearchSelect
            className="h-9"
            items={riders.map((rider) => ({ value: rider.id, label: `${rider.employeeId} ${rider.name}`, keywords: [rider.name, rider.employeeId] }))}
            value={driverId}
            onChange={setDriverId}
            placeholder={t("rider")}
            searchPlaceholder={t("searchRider")}
            recentsKey="roster-change-rider"
          />
          <Input className="h-9" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <select className="h-9 w-full rounded-[10px] border border-[#E2DCD8] bg-white px-2 text-sm" value={kind} onChange={(event) => setKind(event.target.value as ChangeKind)}>
            <option value="times">{t("shiftCol")}</option>
            <option value="off">{t("offDay")}</option>
            <option value="place">{t("restaurant")}</option>
          </select>
          {kind === "times" ? (
            <>
              <Input className="h-9" type="time" value={start} onChange={(event) => setStart(event.target.value)} />
              <Input className="h-9" type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={endsNext} onChange={(event) => setEndsNext(event.target.checked)} />{t("endsNext")}</label>
            </>
          ) : null}
          {kind === "place" ? (
            <SearchSelect
              className="h-9"
              items={places.map((place) => ({ value: place.id, label: place.name, keywords: [place.name, place.storeCc] }))}
              value={restaurantId}
              onChange={setRestaurantId}
              placeholder={t("restaurant")}
              searchPlaceholder={t("restaurant")}
              recentsKey="roster-change-place"
            />
          ) : null}
          <Input className="h-9" value={reason} placeholder={t("reason")} onChange={(event) => setReason(event.target.value)} />
          <button type="button" className={rosterBtn} disabled={!driverId || !date || (kind === "place" && !restaurantId)} onClick={() => void submit()}>{t("sendApproval")}</button>
          <h2 className="pt-2 text-sm font-semibold">{t("howUsed")}</h2>
          <ul className="space-y-1 text-xs text-[#5E5754]">
            <li>{t("changesLead")}</li>
            <li>{t("overwriteWarning")}</li>
            <li>{t("phoneKeepsUpload")}</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
