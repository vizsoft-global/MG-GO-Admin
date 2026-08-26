import type { GoogleMapStyleRule } from "@/lib/google-maps/load";

/**
 * Blocks-mode basemap: strip the clutter a painter has to aim through — business
 * and POI pins, transit stops, road names and shields — while keeping
 * administrative labels, because the district name is the one piece of text that
 * tells you *which* area you are blocking out.
 *
 * `administrative` is left untouched rather than turned off and selectively
 * re-enabled, so locality, neighbourhood and province names all survive. Only
 * land parcels go, which are plot-level noise at painting zoom.
 */
export function buildBlocksModeStyles(): GoogleMapStyleRule[] {
  return [
    {
      featureType: "poi",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
    {
      featureType: "transit",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
    {
      featureType: "road",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
    {
      featureType: "administrative.land_parcel",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
  ];
}

/** Roadmap styles: hide POI, street, and administrative text labels. */
export function buildZoneMapStyles(hideLabels: boolean): GoogleMapStyleRule[] {
  if (!hideLabels) return [];
  return [
    {
      featureType: "poi",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
    {
      featureType: "road",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
    {
      featureType: "administrative",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
    {
      featureType: "transit",
      elementType: "labels",
      stylers: [{ visibility: "off" }],
    },
  ];
}
