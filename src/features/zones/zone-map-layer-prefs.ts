/** Shared Google Maps layer preferences (layers control + map inner). */

export const ZONE_MAP_PREFS_STORAGE_KEY = "dpd:zones:map-prefs";
export const ZONE_MAP_PREFS_CHANGED = "dpd:zones:map-prefs-changed";

export type ZoneMapLayerPrefs = {
  mapType: string;
  traffic: boolean;
  transit: boolean;
  bicycling: boolean;
  hideLabels: boolean;
  showLabels: boolean;
  showLiveDrivers: boolean;
};

export const DEFAULT_ZONE_MAP_PREFS: ZoneMapLayerPrefs = {
  mapType: "roadmap",
  traffic: false,
  transit: false,
  bicycling: false,
  hideLabels: false,
  showLabels: true,
  showLiveDrivers: true,
};

export function loadZoneMapPrefs(): ZoneMapLayerPrefs {
  if (typeof window === "undefined") return DEFAULT_ZONE_MAP_PREFS;
  try {
    const raw = localStorage.getItem(ZONE_MAP_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_ZONE_MAP_PREFS;
    const parsed = JSON.parse(raw) as Partial<ZoneMapLayerPrefs>;
    return {
      ...DEFAULT_ZONE_MAP_PREFS,
      ...parsed,
      showLabels: parsed.showLabels ?? DEFAULT_ZONE_MAP_PREFS.showLabels,
    };
  } catch {
    return DEFAULT_ZONE_MAP_PREFS;
  }
}

export function saveZoneMapPrefs(prefs: ZoneMapLayerPrefs) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ZONE_MAP_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(
      new CustomEvent(ZONE_MAP_PREFS_CHANGED, { detail: prefs }),
    );
  } catch {
    /* ignore */
  }
}

export function subscribeZoneMapPrefs(
  onChange: (prefs: ZoneMapLayerPrefs) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ZoneMapLayerPrefs>).detail;
    onChange(detail ?? loadZoneMapPrefs());
  };

  window.addEventListener(ZONE_MAP_PREFS_CHANGED, handler);
  return () => window.removeEventListener(ZONE_MAP_PREFS_CHANGED, handler);
}
