export type ZoneSortKey =
  | "nameAsc"
  | "nameDesc"
  | "newest"
  | "oldest"
  | "driversDesc"
  | "driversAsc";

export type ZoneListPrefs = {
  sort: ZoneSortKey;
};

export const ZONE_LIST_PREFS_STORAGE_KEY = "dpd:zones:list-prefs";

export const DEFAULT_ZONE_LIST_PREFS: ZoneListPrefs = {
  sort: "nameAsc",
};

export function loadZoneListPrefs(): ZoneListPrefs {
  if (typeof window === "undefined") return DEFAULT_ZONE_LIST_PREFS;
  try {
    const raw = localStorage.getItem(ZONE_LIST_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_ZONE_LIST_PREFS;
    return { ...DEFAULT_ZONE_LIST_PREFS, ...JSON.parse(raw) } as ZoneListPrefs;
  } catch {
    return DEFAULT_ZONE_LIST_PREFS;
  }
}

export function saveZoneListPrefs(prefs: ZoneListPrefs) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ZONE_LIST_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
