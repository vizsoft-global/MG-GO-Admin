/** Performance SOP v1.2 ratios. A missing or non-positive denominator is null, never 0. */

export type EfficiencyBenchmark = "restaurant" | "zone_vehicle";

export function positiveRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

/** Minutes from heading/pickup until the customer. Missing, zero, and negative spans are dropped. */
export function deliveryMinutes(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms / 60_000;
}

/**
 * The restaurant with the most orders. A tie keeps the restaurant of the latest delivery.
 * Map iteration order is the fallback when that latest id is not among the leaders.
 */
export function primaryRestaurantId(
  counts: ReadonlyMap<string, number>,
  lastRestaurantId: string | null,
): string | null {
  let best = 0;
  for (const count of counts.values()) if (count > best) best = count;
  if (best <= 0) return null;
  if (lastRestaurantId && (counts.get(lastRestaurantId) ?? 0) === best) return lastRestaurantId;
  for (const [id, count] of counts) if (count === best) return id;
  return null;
}

/**
 * Keeta-type riders are scored against zone & vehicle DPD. Everyone else uses restaurant DPD.
 * A stored `efficiency_benchmark` of restaurant or zone_vehicle wins over the name.
 */
export function efficiencyBenchmarkMode(input: {
  stored: string | null;
  projectKey: string | null;
  partnerKey: string | null;
  partnerName: string | null;
}): EfficiencyBenchmark {
  const stored = (input.stored ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (stored === "restaurant") return "restaurant";
  if (stored === "zone_vehicle" || stored === "zone_and_vehicle") return "zone_vehicle";
  const blob = [input.projectKey, input.partnerKey, input.partnerName]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ")
    .toLowerCase();
  return blob.includes("keeta") ? "zone_vehicle" : "restaurant";
}
