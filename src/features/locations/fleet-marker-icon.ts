import {
  DEFAULT_PIN_FILL,
  DEFAULT_PIN_RING,
  PIN_STATUS_FILL,
  PIN_STATUS_RING,
} from "@/lib/ui/map-colors";
import type { PinStatus } from "./types";

type VehicleType = "bike" | "car";

const BIKE_PATH =
  "M6 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm12 0a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM9 8.5h3.2l1.3 2.8h2.7l1.6-2.3a.9.9 0 0 1 1.47 1.04l-1.88 2.7a1.2 1.2 0 0 1-.99.5h-3.5a1.2 1.2 0 0 1-1.09-.7l-.72-1.54-1.23 2.25a2.2 2.2 0 0 1-1.93 1.16H7.2a.9.9 0 1 1 0-1.8h1.42c.15 0 .28-.08.36-.21l1.53-2.82-1.5-3.22H7.8a.9.9 0 1 1 0-1.8h1.8c.47 0 .9.27 1.1.7L12 8.5h-1.05";
const CAR_PATH =
  "M6.3 14.8h11.4l-.42 2.2a1 1 0 0 1-.99.8h-1.18a1 1 0 0 1-.99-.8l-.09-.48H9.97l-.09.48a1 1 0 0 1-.99.8H7.71a1 1 0 0 1-.99-.8l-.42-2.2Zm11.85-1.8H5.85c-.62 0-1.06-.6-.87-1.19l.8-2.44c.22-.66.85-1.11 1.55-1.11h9.34c.7 0 1.33.45 1.55 1.11l.8 2.44c.19.58-.25 1.19-.87 1.19ZM8.7 11.35a.95.95 0 1 0 0-1.9.95.95 0 0 0 0 1.9Zm6.6 0a.95.95 0 1 0 0-1.9.95.95 0 0 0 0 1.9Z";

function markerSvg({
  fill,
  ring,
  selected,
  vehicle = "bike",
}: {
  fill: string;
  ring: string;
  selected: boolean;
  vehicle?: VehicleType;
}) {
  const glyph = vehicle === "car" ? CAR_PATH : BIKE_PATH;
  const ringOpacity = selected ? "0.28" : "0.18";
  const circleSize = selected ? 14.5 : 13.5;
  return `
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="${selected ? "18" : "16.5"}" fill="${ring}" fill-opacity="${ringOpacity}" />
      <circle cx="20" cy="20" r="${circleSize}" fill="${fill}" />
      <circle cx="20" cy="20" r="${circleSize}" stroke="white" stroke-width="2" />
      <path d="${glyph}" fill="white"/>
    </svg>
  `;
}

export function createFleetMarkerIcon(opts?: {
  pinStatus?: PinStatus | null;
  selected?: boolean;
  vehicle?: VehicleType;
}) {
  const pinStatus = opts?.pinStatus ?? null;
  const fill = (pinStatus && PIN_STATUS_FILL[pinStatus]) || DEFAULT_PIN_FILL;
  const ring = (pinStatus && PIN_STATUS_RING[pinStatus]) || DEFAULT_PIN_RING;
  const svg = markerSvg({
    fill,
    ring,
    selected: Boolean(opts?.selected),
    vehicle: opts?.vehicle ?? "bike",
  });

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: { width: 40, height: 40 },
    anchor: { x: 20, y: 20 },
  };
}
