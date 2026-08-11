export const RESTAURANT_STATUSES = ["draft", "published", "archived"] as const;

export type RestaurantStatus = (typeof RESTAURANT_STATUSES)[number];

/** Postgres `restaurant_status` enum (no `archived` — archive is UI + is_active=false). */
export type DbRestaurantStatus = "draft" | "published" | "active";

export function isRestaurantPublished(status: RestaurantStatus): boolean {
  return status === "published";
}

export function isActiveFromRestaurantStatus(status: RestaurantStatus): boolean {
  return isRestaurantPublished(status);
}

/** Map admin UI status → DB enum for insert/update. */
export function toDbRestaurantStatus(status: RestaurantStatus): DbRestaurantStatus {
  if (status === "published") return "published";
  if (status === "archived") return "draft";
  return "draft";
}

/** Map DB enum → admin UI status (`active` treated as published). */
export function fromDbRestaurantStatus(
  status: string | null | undefined,
  isActive?: boolean | null,
): RestaurantStatus {
  if (status === "archived") return "archived";
  if (isActive === false && status !== "published" && status !== "active") {
    return "archived";
  }
  if (status === "published" || status === "active") return "published";
  return "draft";
}
