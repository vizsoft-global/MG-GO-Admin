/** Locked sprite keys. Labels live in `vehicle_types`; these two have map art. */
export const KNOWN_VEHICLE_TYPE_KEYS = ["bike", "car"] as const;
export type KnownVehicleTypeKey = (typeof KNOWN_VEHICLE_TYPE_KEYS)[number];

export const DEFAULT_VEHICLE_TYPE_KEY: KnownVehicleTypeKey = "bike";

export function resolveVehicleTypeKey(
  key: string | null | undefined,
): string {
  const trimmed = key?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_VEHICLE_TYPE_KEY;
}

/** Unmapped catalog keys fall back to bike — rule 12 unknown-vehicle default. */
export function vehicleSpriteKey(
  key: string | null | undefined,
): KnownVehicleTypeKey {
  return key === "car" ? "car" : DEFAULT_VEHICLE_TYPE_KEY;
}

export function vehicleTypeFromDriverJoin(driver: {
  vehicle_type_key?: string | null;
  vehicles?:
    | { vehicle_type_key?: string | null }
    | { vehicle_type_key?: string | null }[]
    | null;
} | null | undefined): KnownVehicleTypeKey {
  const vehicle = Array.isArray(driver?.vehicles) ? driver.vehicles[0] : driver?.vehicles;
  return vehicleSpriteKey(vehicle?.vehicle_type_key ?? driver?.vehicle_type_key);
}
