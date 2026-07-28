import type { DriverRiderCategory } from "./types";

export function parseDriverRiderCategory(
  value: string | null | undefined,
): DriverRiderCategory {
  const normalized = value?.trim();
  if (normalized === "outsourced") return "outsourced";
  return "in_house";
}

export function riderCategoryMessageKey(category: DriverRiderCategory): "inHouse" | "outsourced" {
  return category === "outsourced" ? "outsourced" : "inHouse";
}
