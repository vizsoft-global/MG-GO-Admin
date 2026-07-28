import type { GoogleMapStyleRule } from "@/lib/google-maps/load";

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
