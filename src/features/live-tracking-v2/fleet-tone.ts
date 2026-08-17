/**
 * Tone → class maps for the V2 surfaces.
 *
 * One table, because the rail, the insights panel, the feed and the legend must agree:
 * if Moving is emerald on the map it has to be emerald in the list, the distribution bar
 * and the legend, or the operator has to learn the colour language twice.
 *
 * These are literal Tailwind classes rather than semantic tokens because status colour
 * is fixed by §5 of the rulebook (Moving emerald, On delivery blue, Idle amber, Alert
 * / Offline / GPS Offline rose) and must not drift with the theme accent.
 */

import type { FleetTone } from "./fleet-status";

/** Small pill: status chip on a driver card, flag badge, feed severity marker. */
export const FLEET_TONE_BADGE: Record<FleetTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  primary: "border-blue-200 bg-blue-50 text-blue-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-slate-200 bg-slate-100 text-slate-600",
};

/** Solid dot: legend, connection indicator, feed row marker. */
export const FLEET_TONE_DOT: Record<FleetTone, string> = {
  success: "bg-emerald-500",
  primary: "bg-blue-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  neutral: "bg-slate-400",
};

/** Distribution bar segment. */
export const FLEET_TONE_BAR: Record<FleetTone, string> = {
  success: "bg-emerald-500",
  primary: "bg-blue-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  neutral: "bg-slate-300",
};

/** Text-only accent, for a KPI value that carries a state. */
export const FLEET_TONE_TEXT: Record<FleetTone, string> = {
  success: "text-emerald-700",
  primary: "text-blue-700",
  warning: "text-amber-700",
  danger: "text-rose-700",
  neutral: "text-muted-foreground",
};

export function fleetToneBadge(tone: FleetTone): string {
  return FLEET_TONE_BADGE[tone];
}

export function fleetToneDot(tone: FleetTone): string {
  return FLEET_TONE_DOT[tone];
}
