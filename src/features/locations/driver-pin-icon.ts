import type { PinStatus, TrackingStatus } from "./types";

const STATUS_FILL: Record<PinStatus, string> = {
  active: "#10b981",
  idle: "#f59e0b",
  alert: "#ef4444",
};

const DEFAULT_FILL = "#6366f1";

const GOOGLE_MAPS_CIRCLE_SYMBOL = 0;
const GOOGLE_MAPS_FORWARD_CLOSED_ARROW = 3;

export function driverPinIcon(opts?: {
  pinStatus?: PinStatus | null;
  trackingStatus?: TrackingStatus | null;
  heading?: number | null;
}) {
  const color = (opts?.pinStatus && STATUS_FILL[opts.pinStatus]) || DEFAULT_FILL;

  if (
    opts?.trackingStatus === "moving" &&
    opts.heading != null &&
    !Number.isNaN(opts.heading)
  ) {
    return {
      path: GOOGLE_MAPS_FORWARD_CLOSED_ARROW,
      scale: 4,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeOpacity: 1,
      strokeWeight: 1.5,
      rotation: opts.heading,
    };
  }

  return {
    path: GOOGLE_MAPS_CIRCLE_SYMBOL,
    scale: 7,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeOpacity: 1,
    strokeWeight: 2,
  };
}
