/** Early-drop rules shared by the GPS audit, the report, and the alert sweep. */

export const DEFAULT_EARLY_DROP_NEAR_METERS = 200;
export const DEFAULT_EARLY_DROP_MIN_MINUTES = 4;
export const DEFAULT_EARLY_DROP_CUSTOMER_FAR_METERS = 500;

export type EarlyDropReason =
  | "near_restaurant"
  | "short_duration"
  | "missing_proof"
  | "far_customer";

export type EarlyDropThresholds = {
  nearMeters: number;
  minMinutes: number;
  customerFarMeters: number;
  flagMissingProof: boolean;
};

export const DEFAULT_EARLY_DROP_THRESHOLDS: EarlyDropThresholds = {
  nearMeters: DEFAULT_EARLY_DROP_NEAR_METERS,
  minMinutes: DEFAULT_EARLY_DROP_MIN_MINUTES,
  customerFarMeters: DEFAULT_EARLY_DROP_CUSTOMER_FAR_METERS,
  flagMissingProof: true,
};

export function evaluateEarlyDrop(input: {
  pickupToDropMeters: number | null;
  restaurantToDropMeters: number | null;
  durationMinutes: number | null;
  missingPickupProof: boolean;
  customerToDropMeters: number | null;
  thresholds?: Partial<EarlyDropThresholds>;
}): { early: boolean; reasons: EarlyDropReason[] } {
  const thresholds = { ...DEFAULT_EARLY_DROP_THRESHOLDS, ...input.thresholds };
  const reasons: EarlyDropReason[] = [];
  const near = (meters: number | null) =>
    meters != null && Number.isFinite(meters) && meters <= thresholds.nearMeters;
  if (near(input.pickupToDropMeters) || near(input.restaurantToDropMeters)) {
    reasons.push("near_restaurant");
  }
  if (
    input.durationMinutes != null &&
    Number.isFinite(input.durationMinutes) &&
    input.durationMinutes < thresholds.minMinutes
  ) {
    reasons.push("short_duration");
  }
  if (thresholds.flagMissingProof && input.missingPickupProof) reasons.push("missing_proof");
  if (
    input.customerToDropMeters != null &&
    Number.isFinite(input.customerToDropMeters) &&
    input.customerToDropMeters > thresholds.customerFarMeters
  ) {
    reasons.push("far_customer");
  }
  return { early: reasons.length > 0, reasons };
}
