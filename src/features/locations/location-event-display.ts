import type { DriverLocationEvent, LocationSubmitAction, TrackingStatus } from "./types";

const SUBMIT_MATCH_WINDOW_MS = 8 * 60 * 1000;

export type DeliveryTimestamps = {
  pickup_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
};

export function resolveLocationSubmitAction(
  recordedAt: string,
  delivery: DeliveryTimestamps | undefined,
): LocationSubmitAction | null {
  if (!delivery) return null;

  const eventMs = new Date(recordedAt).getTime();
  if (Number.isNaN(eventMs)) return null;

  const anchors: Array<{ action: LocationSubmitAction; ms: number }> = [];
  if (delivery.pickup_at) {
    const ms = new Date(delivery.pickup_at).getTime();
    if (!Number.isNaN(ms)) anchors.push({ action: "pickup", ms });
  }
  if (delivery.delivered_at) {
    const ms = new Date(delivery.delivered_at).getTime();
    if (!Number.isNaN(ms)) anchors.push({ action: "delivered", ms });
  }
  if (delivery.cancelled_at) {
    const ms = new Date(delivery.cancelled_at).getTime();
    if (!Number.isNaN(ms)) anchors.push({ action: "cancelled", ms });
  }

  if (anchors.length === 0) return null;

  const withinWindow = anchors.filter((a) => Math.abs(eventMs - a.ms) <= SUBMIT_MATCH_WINDOW_MS);
  const pool = withinWindow.length > 0 ? withinWindow : anchors;
  pool.sort((a, b) => Math.abs(eventMs - a.ms) - Math.abs(eventMs - b.ms));
  return pool[0]?.action ?? null;
}

export type LocationEventStatusKey =
  | TrackingStatus
  | LocationSubmitAction
  | "delivery_checkin";

export function locationEventStatusKey(
  event: Pick<DriverLocationEvent, "trackingStatus" | "submitAction">,
): LocationEventStatusKey {
  if (event.trackingStatus === "idle") return "idle";
  if (event.trackingStatus === "moving") return "moving";
  if (event.submitAction) return event.submitAction;
  return "delivery_checkin";
}

export function locationEventStatusMessageKey(key: LocationEventStatusKey): string {
  return `eventStatus.${key}`;
}
