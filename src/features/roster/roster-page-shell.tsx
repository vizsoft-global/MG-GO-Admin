"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import * as XLSX from "xlsx";
import { SlidersHorizontal } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchSelect } from "@/components/ui/search-select";
import { useAuth } from "@/contexts/auth-context";
import { downloadWorkbookXlsx } from "@/features/drivers/import/export-xlsx";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  assignStaffZones,
  fetchRosterDirectory,
  importRestaurantZoneSheet,
  loadRosterThresholds,
  loadZoneStaff,
  saveRestaurantZone,
  saveRosterThresholds,
} from "./roster-actions";
import { RosterUnitField } from "./roster-field";
import { RosterNav } from "./roster-nav";
import { rosterError } from "./roster-result";
import { restaurantZoneSampleWorkbook } from "./roster-sheet";
import {
  rosterBtn,
  rosterBtnSoft,
  rosterCanvas,
  rosterCard,
  rosterChipOff,
  rosterChipOn,
  rosterH1,
  rosterMuted,
  rosterTd,
  rosterTh,
} from "./roster-ui";

function sheetFromFile(file: File): Promise<unknown[][]> {
  return file.arrayBuffer().then((buffer) => {
    const book = XLSX.read(buffer, { type: "array" });
    const sheet = book.Sheets[book.SheetNames[0] ?? ""];
    return sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown[][]) : [];
  });
}

function isTestZone(name: string): boolean {
  return /test/i.test(name);
}

function staffInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase();
}

const EARLY_RULES = [
  { value: 1 as const, key: "ruleAny" as const },
  { value: 2 as const, key: "ruleTwo" as const },
];

const EMPTY_STAFF: Array<{ id: string; name: string; zoneIds: string[]; accessKind: string }> = [];
const EMPTY_ZONES: Array<{ id: string; name: string }> = [];
const EMPTY_PLACES: Array<{ id: string; name: string; storeCc: string; zoneId: string | null; zoneName: string }> = [];
const EMPTY_RIDERS: Array<{ id: string; name: string; employeeId: string; zoneId: string | null }> = [];

type AlertDraft = {
  late: string;
  early: string;
  noLogin: string;
  near: string;
  minutes: string;
  customer: string;
  proof: boolean;
  once: boolean;
  coaches: 1 | 2;
  gpsSkip: string;
};

type SavedAlerts = {
  lateGraceMinutes: number;
  earlyGraceMinutes: number;
  noLoginGraceMinutes: number;
  nearMeters: number;
  minMinutes: number;
  customerMeters: number;
  flagMissingProof: boolean;
  alertOnce: boolean;
  minCoaches: number;
  gpsSkipMeters: number;
};

function alertFromSaved(saved: SavedAlerts | null): AlertDraft {
  return {
    late: String(saved?.lateGraceMinutes ?? 15),
    early: String(saved?.earlyGraceMinutes ?? 10),
    noLogin: String(saved?.noLoginGraceMinutes ?? 60),
    near: String(saved?.nearMeters ?? 200),
    minutes: String(saved?.minMinutes ?? 4),
    customer: String(saved?.customerMeters ?? 500),
    proof: saved?.flagMissingProof ?? true,
    once: saved?.alertOnce ?? true,
    coaches: saved?.minCoaches === 2 ? 2 : 1,
    gpsSkip: String(saved?.gpsSkipMeters ?? 50),
  };
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
  const [draft, setDraft] = useState<Partial<AlertDraft>>({});
  const alerts = { ...alertFromSaved(saved), ...draft };
  const { late, early, noLogin, near, minutes, customer, proof, once, coaches, gpsSkip } = alerts;
  const [showHidden, setShowHidden] = useState(false);
  const [placeFilter, setPlaceFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function patchAlert<K extends keyof AlertDraft>(key: K, value: AlertDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const places = useMemo(
    () => (directory.data && "restaurants" in directory.data ? directory.data.restaurants : EMPTY_PLACES),
    [directory.data],
  );
  const riders = useMemo(
    () => (directory.data && "riders" in directory.data ? directory.data.riders : EMPTY_RIDERS),
    [directory.data],
  );
  const staff = useMemo(
    () => (team.data && "staff" in team.data ? team.data.staff : EMPTY_STAFF),
    [team.data],
  );
  const zones = useMemo(() => {
    if (team.data && "zones" in team.data) return team.data.zones;
    if (directory.data && "zones" in directory.data) return directory.data.zones;
    return EMPTY_ZONES;
  }, [team.data, directory.data]);
  const unassignedCount = places.filter((place) => !place.zoneId).length;
  const visibleZones = showHidden ? zones : zones.filter((zone) => !isTestZone(zone.name));
  const shown = places.filter((place) => {
    if (placeFilter === "all") return true;
    if (placeFilter === "unassigned") return !place.zoneId;
    return place.zoneId === placeFilter;
  });
  const zoneItems = useMemo(
    () => [
      { value: "unassigned", label: t("unassigned"), keywords: [t("unassigned")] },
      ...zones.map((zone) => ({ value: zone.id, label: zone.name, keywords: [zone.name] })),
    ],
    [t, zones],
  );
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
  const listedStaff = useMemo(
    () =>
      [...staff].sort((a, b) => {
        const rank = (kind: string) => (kind === "manager" ? 1 : 0);
        return rank(a.accessKind) - rank(b.accessKind) || a.name.localeCompare(b.name);
      }),
    [staff],
  );

  function earlyRuleLabel(value: 1 | 2): string {
    switch (value) {
      case 1:
        return t("ruleAny");
      case 2:
        return t("ruleTwo");
      default: {
        const _never: never = value;
        return _never;
      }
    }
  }

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
      gpsSkipMeters: Number(gpsSkip) || 50,
    });
    const code = rosterError(result);
    setNote(code ? t(`errors.${code}`) : t("saved"));
    void client.invalidateQueries({ queryKey: ["roster", "settings"] });
  }

  function openCoachForZone(id: string) {
    setZoneId(id);
    setAdding(true);
  }

  async function onPlaceZone(id: string, next: string | null) {
    await saveRestaurantZone(id, next === "unassigned" || !next ? null : next);
    void client.invalidateQueries({ queryKey: ["roster", "directory"] });
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
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("alertRules")}</h2>
          {canManage ? (
            <button type="button" className={rosterBtn} onClick={() => void save()}>
              {t("saveRules")}
            </button>
          ) : null}
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5E5754]">{t("attendanceHead")}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <RosterUnitField label={t("lateAfter")} value={late} unit={t("unitMin")} onChange={(value) => patchAlert("late", value)} />
              <RosterUnitField label={t("earlyBefore")} value={early} unit={t("unitMin")} onChange={(value) => patchAlert("early", value)} />
              <RosterUnitField label={t("noShowBy")} value={noLogin} unit={t("unitMin")} onChange={(value) => patchAlert("noLogin", value)} />
            </div>
            <p className="mt-2 text-[10px] text-[#5E5754]">{t("kuwaitTimeNote")}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5E5754]">{t("earlyHead")}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <RosterUnitField
                label={t("deliveredNear")}
                prefix={t("underPrefix")}
                value={near}
                unit={t("unitMeter")}
                onChange={(value) => patchAlert("near", value)}
              />
              <RosterUnitField
                label={t("pickupToDelivery")}
                prefix={t("underPrefix")}
                value={minutes}
                unit={t("unitMin")}
                onChange={(value) => patchAlert("minutes", value)}
              />
              <RosterUnitField
                label={t("farCustomer")}
                prefix={t("overPrefix")}
                value={customer}
                unit={t("unitMeter")}
                onChange={(value) => patchAlert("customer", value)}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-xs text-[#3D3734]">
                <Checkbox checked={proof} onCheckedChange={(value) => patchAlert("proof", value === true)} />
                {t("missingProof")}
              </label>
              <RosterUnitField
                className="min-w-[220px] flex-1"
                label={t("skipGps")}
                value={gpsSkip}
                unit={t("unitMeter")}
                onChange={(value) => patchAlert("gpsSkip", value)}
              />
            </div>
            <fieldset className="mt-3 rounded-[10px] border border-[#E2DCD8] p-3">
              <legend className="px-1 text-xs text-[#5E5754]">{t("markEarlyWhen")}</legend>
              <div className="flex flex-wrap gap-4">
                {EARLY_RULES.map((rule) => (
                  <label key={rule.value} className="flex items-center gap-2 text-sm text-[#1D1B1A]">
                    <input
                      type="radio"
                      name="early-drop-when"
                      className="accent-[#A8321D]"
                      checked={coaches === rule.value}
                      onChange={() => patchAlert("coaches", rule.value)}
                    />
                    {earlyRuleLabel(rule.value)}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      </section>

      <section className={cn(rosterCard, "p-4")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">{t("zonesTitle")}</h2>
            <p className="text-[11px] text-[#5E5754]">
              {t("zonesMeta", {
                zones: zones.length,
                restaurants: places.length,
                unassigned: unassignedCount,
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-[#3D3734]">
              <Checkbox checked={showHidden} onCheckedChange={(value) => setShowHidden(value === true)} />
              {t("showHidden")}
            </label>
            {canZones ? (
              <Link href="/zones/new" className={rosterBtn}>
                {t("newZone")}
              </Link>
            ) : null}
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {visibleZones.map((zone) => {
            const restaurantCount = places.filter((place) => place.zoneId === zone.id).length;
            const riderCount = riders.filter((rider) => rider.zoneId === zone.id).length;
            const names = coachesByZone.get(zone.id) ?? [];
            return (
              <div key={zone.id} className="rounded-[10px] border border-[#E2DCD8] bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{zone.name}</p>
                  <p className="text-[11px] text-[#5E5754]">{t("zoneStats", { restaurants: restaurantCount, riders: riderCount })}</p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {names.map((name) => (
                    <span key={name} className="rounded-full bg-[#F3F0EE] px-2 py-0.5 text-[11px] text-[#3D3734]">
                      {name}
                    </span>
                  ))}
                  {canZones ? (
                    <button
                      type="button"
                      className="rounded-full border border-[#E2DCD8] px-2 py-0.5 text-[11px] text-[#5E5754]"
                      onClick={() => openCoachForZone(zone.id)}
                    >
                      {t("addCoach")}
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-[#A8321D]">
                  <button type="button" onClick={() => setPlaceFilter(zone.id)}>
                    {t("restaurantsAction")}
                  </button>
                  <Link href={`/zones/${zone.id}/edit`}>{t("renameZone")}</Link>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className={cn(canZones && "grid gap-2 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-stretch")}>
        <section className={cn(rosterCard, "flex h-full flex-col p-4")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("restaurantsTitle")}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={rosterBtnSoft}
                onClick={() => downloadWorkbookXlsx("restaurant-zones.xlsx", restaurantZoneSampleWorkbook())}
              >
                {t("template")}
              </button>
              {canZones ? (
                <label className={cn(rosterBtnSoft, "cursor-pointer")}>
                  {t("bulkUpload")}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
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
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            <button
              type="button"
              className={placeFilter === "all" ? rosterChipOn : rosterChipOff}
              onClick={() => setPlaceFilter("all")}
            >
              {t("all")} · {places.length}
            </button>
            <button
              type="button"
              className={placeFilter === "unassigned" ? rosterChipOn : rosterChipOff}
              onClick={() => setPlaceFilter("unassigned")}
            >
              {t("unassigned")} · {unassignedCount}
            </button>
            {visibleZones.map((zone) => {
              const count = places.filter((place) => place.zoneId === zone.id).length;
              return (
                <button
                  key={zone.id}
                  type="button"
                  className={placeFilter === zone.id ? rosterChipOn : rosterChipOff}
                  onClick={() => setPlaceFilter(zone.id)}
                >
                  {zone.name} · {count}
                </button>
              );
            })}
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#E2DCD8]">
                  <th className={rosterTh}>{t("storeCc")}</th>
                  <th className={rosterTh}>{t("storeName")}</th>
                  <th className={rosterTh}>{t("ridersThisWeek")}</th>
                  <th className={rosterTh}>{t("zone")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 200).map((place) => (
                  <tr key={place.id} className={cn("border-b border-[#E2DCD8]", !place.zoneId && "bg-[#F8F1EA]")}>
                    <td className={rosterTd}>{place.storeCc || "—"}</td>
                    <td className={rosterTd}>{place.name}</td>
                    <td className={rosterTd}>
                      {place.zoneId ? riders.filter((rider) => rider.zoneId === place.zoneId).length : 0}
                    </td>
                    <td className={rosterTd}>
                      {canZones ? (
                        <SearchSelect
                          className="h-9 min-w-[160px]"
                          items={zoneItems}
                          value={place.zoneId ?? "unassigned"}
                          onChange={(next) => void onPlaceZone(place.id, next)}
                          placeholder={t("unassigned")}
                          searchPlaceholder={t("zone")}
                          recentsKey="roster-place-zone"
                        />
                      ) : (
                        place.zoneName || t("unassigned")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-[#5E5754]">{t("restaurantMoveHint")}</p>
        </section>

        {canZones ? (
          <section className={cn(rosterCard, "flex h-full flex-col p-4")}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t("teamAccess")}</h2>
              <button type="button" className={rosterBtnSoft} onClick={() => setAdding((value) => !value)}>
                {t("addMember")}
              </button>
            </div>
            {adding ? (
              <div className="mt-2 flex flex-col gap-2">
                <SearchSelect
                  className="h-9"
                  items={staff
                    .filter((person) => person.accessKind !== "manager")
                    .map((person) => ({ value: person.id, label: person.name, keywords: [person.name] }))}
                  value={staffId}
                  onChange={setStaffId}
                  placeholder={t("areaCoach")}
                  searchPlaceholder={t("areaCoach")}
                  recentsKey="roster-coach"
                />
                <SearchSelect
                  className="h-9"
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
                    void assignStaffZones(person.id, [...new Set([...person.zoneIds, zoneId])]).then(() =>
                      client.invalidateQueries({ queryKey: ["roster", "staff"] }),
                    );
                  }}
                >
                  {t("addCoach")}
                </button>
              </div>
            ) : null}
            <ul className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
              {listedStaff.map((person) => {
                const isManager = person.accessKind === "manager";
                const zoneNames = person.zoneIds
                  .map((id) => zones.find((zone) => zone.id === id)?.name)
                  .filter((name): name is string => Boolean(name));
                return (
                  <li key={person.id} className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#F3F0EE] text-[11px] font-semibold text-[#3D3734]">
                        {staffInitials(person.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{person.name}</p>
                        <p className="text-[11px] text-[#5E5754]">{isManager ? t("opsManager") : t("areaCoach")}</p>
                      </div>
                    </div>
                    <div className="flex max-w-[46%] flex-wrap justify-end gap-1">
                      {isManager ? (
                        <span className="rounded-full bg-[#F6E9E5] px-2 py-0.5 text-[11px] font-semibold text-[#A8321D]">
                          {t("allZones")}
                        </span>
                      ) : (
                        zoneNames.map((name) => (
                          <span key={name} className="rounded-full bg-[#F3F0EE] px-2 py-0.5 text-[11px] text-[#3D3734]">
                            {name}
                          </span>
                        ))
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[10px] text-[#5E5754]">{t("teamHint")}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
