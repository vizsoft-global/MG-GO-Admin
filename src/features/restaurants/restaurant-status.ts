export const RESTAURANT_STATUSES = ["draft", "published", "archived"] as const;

export type RestaurantStatus = (typeof RESTAURANT_STATUSES)[number];

export function isRestaurantPublished(status: RestaurantStatus): boolean {
  return status === "published";
}

export function isActiveFromRestaurantStatus(status: RestaurantStatus): boolean {
  return isRestaurantPublished(status);
}
