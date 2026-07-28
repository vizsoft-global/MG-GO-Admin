import { DEFAULT_ZONE_COLOR, MAP_COLORS } from "@/lib/ui/map-colors";

/** Preset swatches shown in the zone color picker */
export const ZONE_COLOR_PALETTE = [...MAP_COLORS.zonePalette] as const;

export { DEFAULT_ZONE_COLOR };

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export function normalizeZoneColor(color: string | null | undefined): string {
  if (color && HEX_COLOR_RE.test(color)) {
    return color.toUpperCase();
  }
  return DEFAULT_ZONE_COLOR;
}

export function isPaletteColor(color: string): boolean {
  const normalized = normalizeZoneColor(color);
  return ZONE_COLOR_PALETTE.some((c) => c === normalized);
}

/** Pick the first unused palette color, then cycle by index. */
export function pickAutoZoneColor(existingColors: (string | null | undefined)[]): string {
  const used = new Set(
    existingColors.map((c) => normalizeZoneColor(c).toUpperCase()),
  );

  for (const paletteColor of ZONE_COLOR_PALETTE) {
    if (!used.has(paletteColor)) return paletteColor;
  }

  return ZONE_COLOR_PALETTE[existingColors.length % ZONE_COLOR_PALETTE.length]!;
}

export function zonePathStyle(
  color: string,
  options: {
    fillOpacity: number;
    weight: number;
    strokeOpacity?: number;
    dashArray?: string;
  },
) {
  const stroke = normalizeZoneColor(color);
  return {
    color: stroke,
    fillColor: stroke,
    fillOpacity: options.fillOpacity,
    weight: options.weight,
    opacity: options.strokeOpacity ?? 1,
    dashArray: options.dashArray,
  };
}
