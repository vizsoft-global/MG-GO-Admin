/**
 * The three document types a vehicle ledger may hold from now on.
 *
 * `insurance` and `other` were retired: existing rows stay readable (and are
 * labelled "legacy") but no new upload may use them.
 */
export const VEHICLE_DOC_TYPE_VALUES = ["registration", "health_card", "baladiya_card"] as const;

export type VehicleDocType = (typeof VEHICLE_DOC_TYPE_VALUES)[number];

export const LEGACY_VEHICLE_DOC_TYPES = ["insurance", "other"] as const;

export type LegacyVehicleDocType = (typeof LEGACY_VEHICLE_DOC_TYPES)[number];

export function isVehicleDocType(value: string): value is VehicleDocType {
  return (VEHICLE_DOC_TYPE_VALUES as readonly string[]).includes(value);
}

export function isLegacyVehicleDocType(value: string): value is LegacyVehicleDocType {
  return (LEGACY_VEHICLE_DOC_TYPES as readonly string[]).includes(value);
}
