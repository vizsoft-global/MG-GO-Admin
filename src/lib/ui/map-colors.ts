/**
 * Hex colors for Google Maps / Leaflet / SVG markers (APIs require hex, not CSS vars).
 * Values match light-mode semantic tokens in `src/app/themes.css` (oklch → sRGB).
 */
export const MAP_COLORS = {
  primary: "#006A2F",
  success: "#008B45",
  warning: "#E1A035",
  danger: "#CC272E",
  neutral: "#5F6469",
  /** Lighter fills for marker rings / pulses (chart / elevated success-warning-danger). */
  successRing: "#24A965",
  warningRing: "#EBA941",
  dangerRing: "#D74745",
  primaryRing: "#008B45",
  markerStroke: "#FFFFFF",
  routeStroke: "#5F6469",
  /** Zone picker + map polygons — aligned to `--chart-1` … `--chart-5` + danger. */
  zonePalette: [
    "#B54A46",
    "#00A4AC",
    "#008C2F",
    "#C4936B",
    "#7579BB",
    "#CC272E",
  ] as const,
} as const;

export type MapColorKey = keyof typeof MAP_COLORS;

export const DEFAULT_ZONE_COLOR = MAP_COLORS.zonePalette[0];

/** Pin / fleet marker fills by tracking health. */
export const PIN_STATUS_FILL: Record<"active" | "idle" | "alert", string> = {
  active: MAP_COLORS.success,
  idle: MAP_COLORS.warning,
  alert: MAP_COLORS.danger,
};

export const PIN_STATUS_RING: Record<"active" | "idle" | "alert", string> = {
  active: MAP_COLORS.successRing,
  idle: MAP_COLORS.warningRing,
  alert: MAP_COLORS.dangerRing,
};

export const DEFAULT_PIN_FILL = MAP_COLORS.primary;
export const DEFAULT_PIN_RING = MAP_COLORS.primaryRing;

/** Delivery timeline map legend markers. */
export const DELIVERY_MARKER_COLORS = {
  pickup: MAP_COLORS.primary,
  delivered: MAP_COLORS.success,
  cancelled: MAP_COLORS.danger,
  live: MAP_COLORS.warning,
} as const;

export const GEOFENCE_COLORS = {
  inclusion: MAP_COLORS.success,
  exclusion: MAP_COLORS.danger,
} as const;

export const PIN_PULSE_RGBA: Record<"active" | "idle" | "alert", string> = {
  active: "rgba(0, 139, 69, 0.45)",
  idle: "rgba(225, 160, 53, 0.4)",
  alert: "rgba(204, 39, 46, 0.42)",
};
