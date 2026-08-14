/**
 * Feed labels for both event classes.
 *
 * Class B keys (`movement.started`, `overspeed.start`, …) are ours and always translated.
 * Class A keys come from `driver_operation_events`, where there are 36 today and more
 * will be added by the driver app without this page being redeployed — so an unknown key
 * degrades to a humanised form rather than rendering a raw dotted slug or, worse, an
 * i18n error.
 */

import { FLEET_EVENT_KEYS, type FleetEventKey } from "./fleet-status";

const FLEET_KEYS = new Set<string>(Object.values(FLEET_EVENT_KEYS));

/**
 * Class A keys with a hand-written label. Everything else humanises. Kept small on
 * purpose: a curated list that lies is worse than a generic label that does not.
 */
const OPS_KEYS = new Set([
  "duty.on",
  "duty.off",
  "duty.online",
  "duty.offline",
  "duty.auto_checkout",
  "duty.location_cleared",
  "shift.submit",
  "delivery.pickup_create",
  "delivery.complete",
  "delivery.cancel",
  "delivery.auto_cancel",
  "location.zone_entry",
  "location.zone_exit",
  "auth.login",
  "device.signout",
  "security.blocked",
  "security.inactive",
]);

export function isTranslatedEventKey(key: string): boolean {
  return FLEET_KEYS.has(key) || OPS_KEYS.has(key);
}

/** `delivery.pickup_create` → `Delivery pickup create`. */
export function humaniseEventKey(key: string): string {
  const words = key.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Which events carry a numeric value worth interpolating into the label. */
const VALUE_EVENTS = new Set<FleetEventKey>([
  "idle.sustained",
  "overspeed.start",
  "battery.low",
]);

export function eventTakesValue(key: string): boolean {
  return VALUE_EVENTS.has(key as FleetEventKey);
}
