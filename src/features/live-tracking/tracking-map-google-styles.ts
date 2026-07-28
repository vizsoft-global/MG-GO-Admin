import type { GoogleMapStyleRule } from "@/lib/google-maps/load";
import type { TrackingMapStyleId } from "./tracking-map-layer-prefs";

const ROADMAP_BASE: GoogleMapStyleRule[] = [
  { elementType: "geometry", stylers: [{ color: "#f5f6f8" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6b7280" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f8fafc" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#d1d5db" }],
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry.fill",
    stylers: [{ color: "#eef2f7" }],
  },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#e5e7eb" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#e5e7eb" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#f3f4f6" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#e2e8f0" }],
  },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#dbeafe" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c7e8ff" }] },
];

const DARK_BASE: GoogleMapStyleRule[] = [
  { elementType: "geometry", stylers: [{ color: "#1f2937" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#334155" }],
  },
  {
    featureType: "administrative.country",
    elementType: "labels.text.fill",
    stylers: [{ color: "#cbd5e1" }],
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry",
    stylers: [{ color: "#243044" }],
  },
  {
    featureType: "landscape.natural",
    elementType: "geometry",
    stylers: [{ color: "#1d2533" }],
  },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#283246" }] },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#1e3a2b" }],
  },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#374151" }] },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#1f2937" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#475569" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#64748b" }],
  },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2a3344" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b1422" }] },
];

const RETRO_BASE: GoogleMapStyleRule[] = [
  { elementType: "geometry", stylers: [{ color: "#ebe3cd" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#523735" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f1e6" }] },
  {
    featureType: "administrative",
    elementType: "geometry.stroke",
    stylers: [{ color: "#c9b2a6" }],
  },
  {
    featureType: "landscape",
    elementType: "geometry",
    stylers: [{ color: "#e6dcc7" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#dfd2ae" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#a5b076" }],
  },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#f5f1e6" }] },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#fdfcf8" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#f8c967" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#e9bc62" }],
  },
  {
    featureType: "transit.line",
    elementType: "geometry",
    stylers: [{ color: "#dfd2ae" }],
  },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#b9d3c2" }] },
];

const HIDE_LABEL_RULES: GoogleMapStyleRule[] = [
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
  {
    featureType: "administrative",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
];

function withHideLabels(
  base: GoogleMapStyleRule[],
  hideLabels: boolean,
): GoogleMapStyleRule[] {
  return hideLabels ? [...base, ...HIDE_LABEL_RULES] : base;
}

export function buildTrackingMapStyles(
  hideLabels: boolean,
  styleId: TrackingMapStyleId = "roadmap",
): GoogleMapStyleRule[] {
  switch (styleId) {
    case "google":
    case "satellite":
    case "hybrid":
      // Use Google's default look — no custom styling.
      return [];
    case "dark":
      return withHideLabels(DARK_BASE, hideLabels);
    case "retro":
      return withHideLabels(RETRO_BASE, hideLabels);
    case "roadmap":
    default:
      return withHideLabels(ROADMAP_BASE, hideLabels);
  }
}
