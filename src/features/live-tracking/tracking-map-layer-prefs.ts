export const TRACKING_MAP_PREFS_STORAGE_KEY = "dpd:live-tracking:map-prefs";

/**
 * Map style IDs the user can pick from the layers popover.
 * - `roadmap`   — clean, white DPD roadmap (current default)
 * - `satellite` — Google satellite imagery
 * - `hybrid`    — satellite imagery + Google labels overlay
 * - `google`    — Google default styling (no custom styles, slightly cream/yellow look)
 * - `dark`      — modern dark theme
 * - `retro`     — warm beige/sepia retro theme
 */
export type TrackingMapStyleId =
  | "roadmap"
  | "satellite"
  | "hybrid"
  | "google"
  | "dark"
  | "retro";

export type TrackingMapLayerPrefs = {
  mapTypeId: TrackingMapStyleId;
  hideLabels: boolean;
};

const VALID_STYLE_IDS: TrackingMapStyleId[] = [
  "roadmap",
  "satellite",
  "hybrid",
  "google",
  "dark",
  "retro",
];

export const DEFAULT_TRACKING_MAP_PREFS: TrackingMapLayerPrefs = {
  mapTypeId: "roadmap",
  hideLabels: true,
};

/**
 * Map a user-selected style ID to the underlying Google Maps native mapTypeId.
 * Custom-styled options (`roadmap`, `google`, `dark`, `retro`) all sit on top of
 * Google's `roadmap` base; `satellite` and `hybrid` use the imagery base types.
 */
export function nativeMapTypeForStyle(
  style: TrackingMapStyleId,
): "roadmap" | "satellite" | "hybrid" {
  if (style === "satellite" || style === "hybrid") return style;
  return "roadmap";
}

/** True for styles that should not have custom labels-hiding rules applied (imagery). */
export function styleAllowsHideLabels(style: TrackingMapStyleId): boolean {
  return style !== "satellite" && style !== "hybrid";
}

export function loadTrackingMapPrefs(): TrackingMapLayerPrefs {
  if (typeof window === "undefined") return DEFAULT_TRACKING_MAP_PREFS;
  try {
    const raw = localStorage.getItem(TRACKING_MAP_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_TRACKING_MAP_PREFS;
    const parsed = JSON.parse(raw) as Partial<TrackingMapLayerPrefs>;
    const id = parsed.mapTypeId;
    return {
      mapTypeId:
        id && VALID_STYLE_IDS.includes(id) ? id : DEFAULT_TRACKING_MAP_PREFS.mapTypeId,
      hideLabels: parsed.hideLabels ?? DEFAULT_TRACKING_MAP_PREFS.hideLabels,
    };
  } catch {
    return DEFAULT_TRACKING_MAP_PREFS;
  }
}

export function saveTrackingMapPrefs(prefs: TrackingMapLayerPrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TRACKING_MAP_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore localStorage errors
  }
}
