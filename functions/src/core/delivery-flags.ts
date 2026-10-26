import {
  distanceToZoneBoundaryMeters,
  pointWithinZoneProximity,
  type ZoneFeature,
  type ZoneGeometryType,
} from "./geo";

/** Defaults mirror `app_settings` so a missing doc keeps the shipped behaviour. */
export const DEFAULT_EARLY_DROP_METERS = 50;
export const DEFAULT_PROOF_OCR_MODE = "block" as const;
export const PROOF_OCR_MODES = ["block", "warn", "off"] as const;

export type ProofOcrMode = (typeof PROOF_OCR_MODES)[number];

export type DeliveryZone = {
  id?: string | null;
  geometry: unknown;
  zone_type: unknown;
};

export type ZoneEvaluation = {
  inside: boolean;
  distanceM: number | null;
};

export function zoneGeometryType(value: unknown): ZoneGeometryType {
  return value === "circle" ? "circle" : "polygon";
}

/** Zone verdict for a delivered point. `null` means the row has no zone to check. */
export function evaluateDeliveryZone(
  lat: number,
  lng: number,
  zone: DeliveryZone | null | undefined,
): ZoneEvaluation | null {
  if (!zone || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const type = zoneGeometryType(zone.zone_type);
  const feature = zone.geometry as ZoneFeature;
  return {
    inside: pointWithinZoneProximity(lat, lng, feature, type, 0),
    distanceM: distanceToZoneBoundaryMeters(lat, lng, feature, type),
  };
}

/** Uppercase alphanumerics only — OCR punctuation is noise, not identity. */
export function normalizeOrderIdForProof(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length > 0 ? normalized : null;
}

/**
 * OCR may return a prefix/suffix of a long order id. Exact equality is always a
 * match; a containment match is accepted only when both sides are long enough
 * that a coincidental hit is implausible.
 */
export function orderIdsMatch(left: string | null, right: string | null): boolean | null {
  const a = normalizeOrderIdForProof(left);
  const b = normalizeOrderIdForProof(right);
  if (!a || !b) return null;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) {
    return a.endsWith(b) || b.endsWith(a);
  }
  return false;
}

export function isEarlyDrop(distanceM: number | null, thresholdMeters: number): boolean {
  if (distanceM === null || !Number.isFinite(distanceM)) return false;
  const threshold = Number.isFinite(thresholdMeters) ? Math.max(0, thresholdMeters) : DEFAULT_EARLY_DROP_METERS;
  return distanceM <= threshold;
}

export type RosterEarlyDropReason = "near_restaurant" | "short_duration" | "missing_proof" | "far_customer";

/** Keep in sync with `src/features/roster/early-drop-eval.ts`. Functions cannot import `src/`. */
export function evaluateRosterEarlyDrop(input: {
  pickupToDropMeters: number | null;
  restaurantToDropMeters: number | null;
  durationMinutes: number | null;
  missingPickupProof: boolean;
  customerToDropMeters: number | null;
  nearMeters: number;
  minMinutes: number;
  customerFarMeters: number;
  flagMissingProof: boolean;
}): { early: boolean; reasons: RosterEarlyDropReason[] } {
  const reasons: RosterEarlyDropReason[] = [];
  const near = (meters: number | null) => meters != null && Number.isFinite(meters) && meters <= input.nearMeters;
  if (near(input.pickupToDropMeters) || near(input.restaurantToDropMeters)) reasons.push("near_restaurant");
  if (input.durationMinutes != null && Number.isFinite(input.durationMinutes) && input.durationMinutes < input.minMinutes) {
    reasons.push("short_duration");
  }
  if (input.flagMissingProof && input.missingPickupProof) reasons.push("missing_proof");
  if (
    input.customerToDropMeters != null &&
    Number.isFinite(input.customerToDropMeters) &&
    input.customerToDropMeters > input.customerFarMeters
  ) {
    reasons.push("far_customer");
  }
  return { early: reasons.length > 0, reasons };
}

/** Stable order: the list chip reads early drop, then zone. */
export function flagLabelsFor(input: { earlyDrop: boolean; outOfZone: boolean | null }): string[] {
  const labels: string[] = [];
  if (input.earlyDrop) labels.push("early_drop");
  if (input.outOfZone === true) labels.push("outside_zone");
  return labels;
}

export function normalizeProofOcrMode(value: unknown): ProofOcrMode {
  return typeof value === "string" && (PROOF_OCR_MODES as readonly string[]).includes(value)
    ? (value as ProofOcrMode)
    : DEFAULT_PROOF_OCR_MODE;
}

export type ProofOcrDecision = "block" | "accept";

/**
 * A mismatch is only a refusal when the fleet is in `block` mode and the rider
 * has not supplied an override reason. A missing OCR value is never a mismatch.
 */
export function proofOcrDecision(input: {
  mode: ProofOcrMode;
  matched: boolean | null;
  overrideReason?: string | null;
}): ProofOcrDecision {
  if (input.mode !== "block") return "accept";
  if (input.matched !== false) return "accept";
  const reason = input.overrideReason?.trim() ?? "";
  return reason.length > 0 ? "accept" : "block";
}
