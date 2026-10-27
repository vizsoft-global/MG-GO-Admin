"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { selectOptions } from "@/lib/select-items";
import { cn } from "@/lib/utils";
import { decideRosterChange, fetchDriverRosterWeek, fetchRosterChanges, fetchRosterDirectory, requestRosterChange } from "./roster-actions";
import type { RosterChangeStatus } from "./roster-changes";
import { RosterField } from "./roster-field";
import { RosterNav } from "./roster-nav";
import { clock12, formatDayLabel } from "./roster-range";
import { rosterError } from "./roster-result";
import {
  rosterBtn,
  rosterBtnOk,
  rosterBtnSoft,
  rosterCanvas,
  rosterCard,
  rosterChipOff,
  rosterChipOn,
  rosterH1,
  rosterMuted,
} from "./roster-ui";

type ChangeKind = "times" | "off" | "place";
type ChangeTab = "all" | "waiting" | "approved" | "rejected";

const TABS: ChangeTab[] = ["waiting", "approved", "rejected", "all"];

export function RosterChangesShell() {
  const t = useTranslations("pages.roster");
  const locale = useLocale();
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
  const kindItems = selectOptions([
    { value: "times", label: t("shiftTimes") },
    { value: "off", label: t("offDay") },
    { value: "place", label: t("restaurant") },
  ]);

  function zoneName(id: string | null) {
    return zones.find((zone) => zone.id === id)?.name ?? "";
  }

  function windowText(off: boolean, startAt: string | null, endAt: string | null) {
    return off ? t("offDay") : `${clock12(startAt)} – ${clock12(endAt)}`;
  }

  function tabCount(key: ChangeTab) {
    switch (key) {
      case "all":
        return rows.length;
      case "waiting":
      case "approved":
      case "rejected":
        return rows.filter((row) => row.status === key).length;
      default: {
        const _never: never = key;
        return _never;
      }
    }
  }

  function tabLabel(key: ChangeTab, count: number) {
    switch (key) {
      case "waiting":
        return `${t("changeStatus.waiting")} · ${count}`;
      case "approved":
        return `${t("changeStatus.approved")} · ${count}`;
      case "rejected":
        return `${t("changeStatus.rejected")} · ${count}`;
      case "all":
        return t("allCount", { count });
      default: {
        const _never: never = key;
        return _never;
      }
    }
  }

  function shownRows() {
    switch (tab) {
      case "all":
        return rows;
      case "waiting":
      case "approved":
      case "rejected":
        return rows.filter((row) => row.status === tab);
      default: {
        const _never: never = tab;
        return _never;
      }
    }
  }

  function statusPill(status: RosterChangeStatus) {
    switch (status) {
      case "waiting":
        return (
          <span className="inline-flex h-7 items-center rounded-full bg-[#FDF0DC] px-2.5 text-xs font-semibold text-[#8A4B06]">
            {t("waitingForApproval")}
          </span>
        );
      case "approved":
        return (
          <span className="inline-flex h-7 items-center rounded-full bg-[#E7F6EE] px-2.5 text-xs font-semibold text-[#146C43]">
            {t("changeStatus.approved")}
          </span>
        );
      case "rejected":
        return (
          <span className="inline-flex h-7 items-center rounded-full bg-[#FDE7E5] px-2.5 text-xs font-semibold text-[#A3221A]">
            {t("changeStatus.rejected")}
          </span>
        );
      default: {
        const _never: never = status;
        return _never;
      }
    }
  }

  function kindFields() {
    switch (kind) {
      case "times":
        return (
          <>
            <div className="grid grid-cols-2 gap-2">
              <RosterField label={t("newStart")}>
                <Input className="h-9" type="time" value={start} onChange={(event) => setStart(event.target.value)} />
              </RosterField>
              <RosterField label={t("newEnd")}>
                <Input className="h-9" type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
              </RosterField>
            </div>
            <label className="flex items-center gap-2 text-xs text-[#5E5754]">
              <Checkbox checked={endsNext} onCheckedChange={(value) => setEndsNext(value === true)} />
              {t("endsNext")}
            </label>
          </>
        );
      case "place":
        return (
          <RosterField label={t("restaurant")}>
            <SearchSelect
              className="h-9"
              items={places.map((place) => ({ value: place.id, label: place.name, keywords: [place.name, place.storeCc] }))}
              value={restaurantId}
              onChange={setRestaurantId}
              placeholder={t("restaurant")}
              searchPlaceholder={t("restaurant")}
              recentsKey="roster-change-place"
            />
          </RosterField>
        );
      case "off":
        return null;
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  }

  const shown = shownRows();

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
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <section className={cn(rosterCard, "overflow-hidden")}>
          <div className="flex flex-wrap gap-1 border-b border-[#E2DCD8] px-3 py-2">
            {TABS.map((key) => {
              const count = tabCount(key);
              return (
                <button
                  key={key}
                  type="button"
                  className={tab === key ? rosterChipOn : rosterChipOff}
                  onClick={() => setTab(key)}
                >
                  {tabLabel(key, count)}
                </button>
              );
            })}
          </div>
          <div>
            {shown.map((row, index) => {
              const beforePlace = places.find((place) => place.id === row.beforeRestaurantId)?.name ?? "";
              const place = [beforePlace || row.restaurantName, zoneName(row.zoneId)].filter(Boolean).join(" · ");
              return (
                <article
                  key={row.id}
                  className={cn(
                    "grid gap-3 px-3 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto]",
                    index > 0 && "border-t border-[#E2DCD8]",
                    row.status === "waiting" && "bg-[#FFF8F1]",
                  )}
                >
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {row.driverName} <span className="font-normal text-[#5E5754]">#{row.employeeId}</span>
                    </p>
                    <p className="text-xs text-[#5E5754]">{place || "—"}</p>
                    <p className="text-xs text-[#5E5754]">{formatDayLabel(row.date, locale)}</p>
                  </div>
                  <div className="min-w-0">
                    <p>
                      {windowText(row.beforeOff, row.beforeStart, row.beforeEnd)}
                      {" → "}
                      {row.restaurantName && !row.afterOff ? (
                        <span className="font-semibold text-[#2563EB]">
                          {row.restaurantName} · {windowText(false, row.afterStart, row.afterEnd)}
                        </span>
                      ) : (
                        windowText(row.afterOff, row.afterStart, row.afterEnd)
                      )}
                    </p>
                    {row.reason ? (
                      <p className="text-xs text-[#5E5754]">
                        {t("reason")}: {row.reason}
                      </p>
                    ) : null}
                    <p className="text-xs text-[#5E5754]">
                      {t("requestedBy")} {row.requestedByName}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    {statusPill(row.status)}
                    {canDecide && row.status === "waiting" ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={rosterBtnOk}
                          onClick={() => void decideRosterChange(row.id, "approved").then(() => client.invalidateQueries({ queryKey: ["roster", "changes"] }))}
                        >
                          {t("approve")}
                        </button>
                        <button
                          type="button"
                          className={rosterBtnSoft}
                          onClick={() => void decideRosterChange(row.id, "rejected").then(() => client.invalidateQueries({ queryKey: ["roster", "changes"] }))}
                        >
                          {t("reject")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
            {shown.length === 0 ? <p className={cn(rosterMuted, "px-3 py-3")}>{t("noRows")}</p> : null}
          </div>
        </section>
        <aside className={cn(rosterCard, "space-y-3 p-4")}>
          <h2 className="text-sm font-semibold">{t("requestChange")}</h2>
          <RosterField label={t("rider")}>
            <SearchSelect
              className="h-9"
              items={riders.map((rider) => ({
                value: rider.id,
                label: `${rider.employeeId} ${rider.name}`,
                keywords: [rider.name, rider.employeeId],
              }))}
              value={driverId}
              onChange={setDriverId}
              placeholder={t("nameOrId")}
              searchPlaceholder={t("nameOrId")}
              recentsKey="roster-change-rider"
            />
          </RosterField>
          <div className="flex gap-2">
            <RosterField label={t("date")}>
              <Input className="h-9" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </RosterField>
            <RosterField label={t("changeKind")}>
              <Select
                items={kindItems}
                value={kind}
                onValueChange={(value) => {
                  switch (value) {
                    case "times":
                    case "off":
                    case "place":
                      setKind(value);
                      break;
                    default:
                      break;
                  }
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kindItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </RosterField>
          </div>
          {kindFields()}
          <RosterField label={t("reason")}>
            <Input className="h-9" value={reason} placeholder={t("reason")} onChange={(event) => setReason(event.target.value)} />
          </RosterField>
          <button
            type="button"
            className={cn(rosterBtn, "w-full")}
            disabled={!driverId || !date || (kind === "place" && !restaurantId)}
            onClick={() => void submit()}
          >
            {t("sendApproval")}
          </button>
        </aside>
      </div>
    </div>
  );
}
