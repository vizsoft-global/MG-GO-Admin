import type { RestaurantGeofenceDraft, RestaurantGeofenceInput } from "./types";

export function draftGeofencesToInput(
  drafts: RestaurantGeofenceDraft[],
): RestaurantGeofenceInput[] {
  return drafts.map((draft) => ({
    id: draft.id.startsWith("temp-") ? undefined : draft.id,
    kind: draft.kind,
    zone_type: draft.zone_type,
    geometry: draft.geometry,
    name: draft.name,
    color: draft.color,
  }));
}
