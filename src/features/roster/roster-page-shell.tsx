"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import * as XLSX from "xlsx";
import { SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SearchSelect } from "@/components/ui/search-select";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { RosterNav } from "./roster-nav";
import { rosterError } from "./roster-result";
import { rosterBtn, rosterBtnSoft, rosterCanvas, rosterCard, rosterH1, rosterMuted, rosterTd, rosterTh } from "./roster-ui";
import {
  assignStaffZones,
  fetchRosterDirectory,
  importRestaurantZoneSheet,
  loadRosterThresholds,
  loadZoneStaff,
  saveRosterThresholds,
} from "./roster-actions";

function sheetFromFile(file: File): Promise<unknown[][]> {
  return file.arrayBuffer().then((buffer) => {
    const book = XLSX.read(buffer, { type: "array" });
    const sheet = book.Sheets[book.SheetNames[0] ?? ""];
    return sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown[][]) : [];
  });
}

export function RosterPageShell() {
  const t = useTranslations("pages.roster");
  const client = useQueryClient();
  const { can } = useAuth();
  const canManage = can("attendance.manage");
  const canZones = can("zones.manage");
  const settings = useQuery({ queryKey: ["roster", "settings"], queryFn: loadRosterThresholds });
  const directory = useQuery({ queryKey: ["roster", "directory"], queryFn: fetchRosterDirectory });
  const team = useQuery({ queryKey: ["roster", "staff"], queryFn: loadZoneStaff, enabled: canZones });
  const saved = settings.data && "lateGraceMinutes" in settings.data ? settings.data : null;
  const [late, setLate] = useState("15");
  const [early, setEarly] = useState("10");
  const [noLogin, setNoLogin] = useState("60");
  const [near, setNear] = useState("200");
  const [minutes, setMinutes] = useState("4");
  const [customer, setCustomer] = useState("500");
  const [proof, setProof] = useState(true);
  const [once, setOnce] = useState(true);
  const [coaches, setCoaches] = useState<1 | 2>(1);
  const [unassigned, setUnassigned] = useState(false);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) return;
    setLate(String(saved.lateGraceMinutes));
    setEarly(String(saved.earlyGraceMinutes));
    setNoLogin(String(saved.noLoginGraceMinutes));
    setNear(String(saved.nearMeters));
    setMinutes(String(saved.minMinutes));
    setCustomer(String(saved.customerMeters));
    setProof(saved.flagMissingProof);
    setOnce(saved.alertOnce);
    setCoaches(saved.minCoaches === 2 ? 2 : 1);
  }, [saved]);

  const places = directory.data && "restaurants" in directory.data ? directory.data.restaurants : [];
  const shown = unassigned ? places.filter((place) => !place.zoneId) : places;
  const staff = team.data && "staff" in team.data ? team.data.staff : [];
  const zones = team.data && "zones" in team.data ? team.data.zones : directory.data && "zones" in directory.data ? directory.data.zones : [];
  const coachesByZone = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const person of staff) {
      if (person.accessKind === "manager") continue;
      for (const id of person.zoneIds) {
        const list = map.get(id) ?? [];
        list.push(person.name);
        map.set(id, list);
      }
    }
    return map;
  }, [staff]);

  async function save() {
    const result = await saveRosterThresholds({
      lateGraceMinutes: Number(late) || 15,
      earlyGraceMinutes: Number(early) || 10,
      noLoginGraceMinutes: Number(noLogin) || 60,
      nearMeters: Number(near) || 200,
      minMinutes: Number(minutes) || 4,
      customerMeters: Number(customer) || 500,
      flagMissingProof: proof,
      alertOnce: once,
      minCoaches: coaches,
    });
    const code = rosterError(result);
    setNote(code ? t(`errors.${code}`) : t("saved"));
    void client.invalidateQueries({ queryKey: ["roster", "settings"] });
  }

  return (
    <div className={rosterCanvas}>
      <RosterNav />
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-[#A8321D] text-white">
          <SlidersHorizontal className="size-4" fill="currentColor" strokeWidth={2.5} aria-hidden />
        </span>
        <div>
          <h1 className={rosterH1}>{t("navSetup")}</h1>
          <p className={rosterMuted}>{t("setupLead")}</p>
        </div>
      </div>
      {note ? <p className="text-sm text-[#5E5754]">{note}</p> : null}
      <section className={cn(rosterCard, "p-4")}>
        <h2 className="text-sm font-semibold">{t("alertRules")}</h2>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-[#5E5754]">{t("attendanceHead")}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-[#5E5754]">{t("lateGrace")}<Input className="h-9" value={late} onChange={(event) => setLate(event.target.value)} /></label>
          <label className="text-xs text-[#5E5754]">{t("earlyGrace")}<Input className="h-9" value={early} onChange={(event) => setEarly(event.target.value)} /></label>
          <label className="text-xs text-[#5E5754]">{t("noLoginGrace")}<Input className="h-9" value={noLogin} onChange={(event) => setNoLogin(event.target.value)} /></label>
        </div>
        <p className="mt-2 text-xs text-[#5E5754]">{t("noAlertsOff")}</p>
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[#5E5754]">{t("earlyHead")}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-[#5E5754]">{t("nearMeters")}<Input className="h-9" value={near} onChange={(event) => setNear(event.target.value)} /></label>
          <label className="text-xs text-[#5E5754]">{t("minMinutes")}<Input className="h-9" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
          <label className="text-xs text-[#5E5754]">{t("customerMeters")}<Input className="h-9" value={customer} onChange={(event) => setCustomer(event.target.value)} /></label>
        </div>
        <p className="mt-2 text-xs text-[#5E5754]">{t("anyRule")}</p>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={proof} onChange={(event) => setProof(event.target.checked)} />
          {t("missingProof")}
        </label>
        <label className="mt-1 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={once} onChange={(event) => setOnce(event.target.checked)} />
          {t("alertOnce")}
        </label>
        <div className="mt-2 flex gap-1">
          {([1, 2] as const).map((count) => (
            <button
              key={count}
              type="button"
              className={cn("h-9 rounded-[10px] px-3 text-xs font-semibold", coaches === count ? "bg-[#1D1B1A] text-white" : "bg-[#F3F0EE] text-[#3D3734]")}
              onClick={() => setCoaches(count)}
            >
              {count === 1 ? t("audienceAny") : t("audienceTwo")}
            </button>
          ))}
        </div>
        {canManage ? <button type="button" className={cn(rosterBtn, "mt-3")} onClick={() => void save()}>{t("saveRules")}</button> : null}
      </section>
      <section className={cn(rosterCard, "p-4")}>
        <h2 className="text-sm font-semibold">{t("zonesTitle")}</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {zones.map((zone) => (
            <div key={zone.id} className="rounded-[10px] bg-[#F3F0EE] p-3 text-xs">
              <p className="font-semibold">{zone.name}</p>
              <p className="text-[#5E5754]">{t("coaches")}: {(coachesByZone.get(zone.id) ?? []).join(", ") || "—"}</p>
            </div>
          ))}
        </div>
      </section>
      <section className={cn(rosterCard, "p-4")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("restaurantsTitle")}</h2>
          <button type="button" className={cn("h-9 rounded-[10px] px-3 text-xs font-semibold", unassigned ? "bg-[#1D1B1A] text-white" : "bg-[#F3F0EE] text-[#3D3734]")} onClick={() => setUnassigned((value) => !value)}>
            {t("filterUnassigned")}
          </button>
        </div>
        {canZones ? (
          <label className={cn(rosterBtnSoft, "mt-2 cursor-pointer")}>
            {t("chooseFile")}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void sheetFromFile(file).then(async (aoa) => {
                  const result = await importRestaurantZoneSheet(aoa);
                  if ("written" in result && Array.isArray(result.failed)) setNote(`${t("written")} ${result.written}`);
                  else setNote(t(`errors.${rosterError(result) ?? "not_configured"}`));
                  void client.invalidateQueries({ queryKey: ["roster", "directory"] });
                });
              }}
            />
          </label>
        ) : null}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#E2DCD8]">
                <th className={rosterTh}>{t("storeCc")}</th>
                <th className={rosterTh}>{t("restaurant")}</th>
                <th className={rosterTh}>{t("zone")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 200).map((place) => (
                <tr key={place.id} className="border-b border-[#E2DCD8]">
                  <td className={rosterTd}>{place.storeCc || "—"}</td>
                  <td className={rosterTd}>{place.name}</td>
                  <td className={rosterTd}>{place.zoneName || t("unassigned")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {canZones ? (
        <section className={cn(rosterCard, "p-4")}>
          <h2 className="text-sm font-semibold">{t("teamAccess")}</h2>
          <p className="text-[10px] text-[#5E5754]">{t("opsManager")}: {staff.filter((person) => person.accessKind === "manager").map((person) => person.name).join(", ") || "—"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <SearchSelect
              className="h-9 min-w-[180px]"
              items={staff.filter((person) => person.accessKind !== "manager").map((person) => ({ value: person.id, label: person.name, keywords: [person.name] }))}
              value={staffId}
              onChange={setStaffId}
              placeholder={t("areaCoach")}
              searchPlaceholder={t("areaCoach")}
              recentsKey="roster-coach"
            />
            <SearchSelect
              className="h-9 min-w-[180px]"
              items={zones.map((zone) => ({ value: zone.id, label: zone.name, keywords: [zone.name] }))}
              value={zoneId}
              onChange={setZoneId}
              placeholder={t("zone")}
              searchPlaceholder={t("zone")}
              recentsKey="roster-zone"
            />
            <button
              type="button"
              className={rosterBtn}
              disabled={!staffId || !zoneId}
              onClick={() => {
                const person = staff.find((row) => row.id === staffId);
                if (!person || !zoneId) return;
                void assignStaffZones(person.id, [...new Set([...person.zoneIds, zoneId])]).then(() => client.invalidateQueries({ queryKey: ["roster", "staff"] }));
              }}
            >
              {t("addCoach")}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
