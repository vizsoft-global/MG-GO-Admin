/** Default map center: Kuwait City area */
export const KUWAIT_MAP_CENTER: [number, number] = [29.37, 47.97];
export const DEFAULT_MAP_ZOOM = 12;

export const CARTO_TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const DEFAULT_MAPTILER_MAP_ID = "streets-v2";

export const ZONE_FILL_COLOR = "#EF5B4D";
export const ZONE_STROKE_COLOR = "#EF5B4D";

/** Faded style for existing zones shown while drawing a new zone */
export const ZONE_REFERENCE_FILL_OPACITY = 0.1;
export const ZONE_REFERENCE_STROKE_OPACITY = 0.45;

export type ZoneMapTileProps = {
  url: string;
  attribution: string;
  provider: "maptiler" | "carto";
};

/** MapTiler raster tiles when API key is set; otherwise CARTO light basemap. */
export function getZoneMapTileProps(): ZoneMapTileProps {
  const key = process.env.NEXT_PUBLIC_MAPTILER_API_KEY?.trim();
  const mapId =
    process.env.NEXT_PUBLIC_MAPTILER_MAP_ID?.trim() || DEFAULT_MAPTILER_MAP_ID;

  if (key) {
    return {
      url: `https://api.maptiler.com/maps/${mapId}/{z}/{x}/{y}.png?key=${key}`,
      attribution:
        '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      provider: "maptiler",
    };
  }

  return {
    url: CARTO_TILE_URL,
    attribution: CARTO_ATTRIBUTION,
    provider: "carto",
  };
}
