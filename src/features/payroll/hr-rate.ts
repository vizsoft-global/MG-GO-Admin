export const HR_VEHICLES = ["Bike", "Car"] as const;

export type HrVehicleType = (typeof HR_VEHICLES)[number];

export type HrRateLine = {
  id: string;
  vehicle: HrVehicleType;
  /** Exact catalog type key (`van`); empty means the Bike/Car bucket decides. */
  vehicleKey?: string;
  /** Job-position catalog key; empty is the wildcard line. */
  position?: string;
  project: string;
  zones: string[];
  rate: number;
};

export type HrRateHit = {
  vehicle: HrVehicleType;
  project: string;
  zone: string;
  rate: number;
  /** The position line that priced it, when the line named one. */
  position?: string;
};

export type HrRateEvent = {
  id: string;
  at: string;
  by: string;
  item: string;
  /** Job-position catalog key the line priced; absent on a wildcard line. */
  position?: string;
  field: "Rate" | "Rate added" | "Rate removed";
  from: string;
  to: string;
};

export const HR_NO_RATE = "No rate";

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export function isHrVehicle(value: string): value is HrVehicleType {
  switch (value) {
    case "Bike":
    case "Car":
      return true;
    default:
      return false;
  }
}

/** A missing vehicle is a bike. Car and van stay a car. */
export function hrVehicleFromKey(key: string | null | undefined): HrVehicleType {
  const value = (key ?? "").trim().toLowerCase();
  if (value.includes("car") || value.includes("van")) return "Car";
  return "Bike";
}

/**
 * The best line for one rider, per project.
 *
 * Four keys decide it, in this order: an exact vehicle-type line beats the
 * Bike/Car bucket, and a position-specific line beats the wildcard. A `van` line
 * and a `Bike` line must never both price the same order — that is why the winner
 * is chosen per project instead of every matching line being summed.
 */
function lineScore(line: HrRateLine, vehicleKey: string, positionKey: string): number {
  const exactVehicle = Boolean(line.vehicleKey) && norm(line.vehicleKey ?? "") === norm(vehicleKey);
  const exactPosition = Boolean(line.position) && norm(line.position ?? "") === norm(positionKey);
  return (exactVehicle ? 2 : 0) + (exactPosition ? 1 : 0);
}

export function matchHrRates(input: {
  vehicleKey: string | null | undefined;
  /** Job-position catalog key on the rider; empty means "no position". */
  positionKey?: string | null;
  projects: readonly string[];
  zone: string;
  lines: readonly HrRateLine[];
}): HrRateHit[] {
  const vehicle = hrVehicleFromKey(input.vehicleKey);
  const vehicleKey = (input.vehicleKey ?? "").trim();
  const positionKey = (input.positionKey ?? "").trim();
  const zone = norm(input.zone);
  const projects = new Set(input.projects.map(norm).filter(Boolean));
  if (!zone || projects.size === 0) return [];
  const winners = new Map<string, { line: HrRateLine; score: number }>();
  for (const line of input.lines) {
    if (!Number.isFinite(line.rate)) continue;
    if (!projects.has(norm(line.project))) continue;
    if (!line.zones.some((item) => norm(item) === zone)) continue;
    // An exact-type line only prices its own type; a bucket line prices the rest.
    if (line.vehicleKey) {
      if (!vehicleKey || norm(line.vehicleKey) !== norm(vehicleKey)) continue;
    } else if (line.vehicle !== vehicle) {
      continue;
    }
    // A position line only prices that position.
    if (line.position && norm(line.position) !== positionKey) continue;
    const score = lineScore(line, vehicleKey, positionKey);
    const key = norm(line.project);
    const current = winners.get(key);
    if (!current || score > current.score) winners.set(key, { line, score });
  }
  return [...winners.values()].map(({ line }) => ({
    vehicle: line.vehicle,
    project: line.project.trim(),
    zone: input.zone.trim(),
    rate: line.rate,
    ...(line.position ? { position: line.position } : {}),
  }));
}

export function hrRateLabel(hits: readonly HrRateHit[], missing = HR_NO_RATE): string {
  if (hits.length === 0) return missing;
  return hits
    .map((hit) => (hit.position ? `${hit.rate.toFixed(3)} · ${hit.position}` : hit.rate.toFixed(3)))
    .join(" · ");
}

export function hrVehicleLabel(hits: readonly HrRateHit[], missing = "—"): string {
  if (hits.length === 0) return missing;
  return [...new Set(hits.map((hit) => hit.vehicle))].join(" · ");
}

/** Each matching project rate is counted. One rate is orders × rate. */
export function hrRateRevenue(orders: number, hits: readonly HrRateHit[]): number {
  let sum = 0;
  for (const hit of hits) sum += orders * hit.rate;
  return sum;
}

export function hrRateKey(vehicle: string, project: string, zone: string, position = "", vehicleKey = ""): string {
  return `${norm(vehicleKey || vehicle)}|${norm(project)}|${norm(zone)}|${norm(position)}`;
}

/**
 * Two lines that would price the same order are refused, not silently resolved.
 *
 * A wildcard and a position line for the same vehicle/project/zone are a
 * legitimate pair (the specific one wins); the same pair twice is a mistake that
 * would make the sheet depend on row order.
 */
export function duplicateRateLine(
  lines: readonly HrRateLine[],
  candidate: HrRateLine,
): HrRateLine | null {
  const project = norm(candidate.project);
  const position = norm(candidate.position ?? "");
  const vehicleKey = norm(candidate.vehicleKey ?? "");
  for (const line of lines) {
    if (line.id === candidate.id) continue;
    if (norm(line.project) !== project) continue;
    if (norm(line.position ?? "") !== position) continue;
    if (norm(line.vehicleKey ?? "") !== vehicleKey) continue;
    if (vehicleKey === "" && line.vehicle !== candidate.vehicle) continue;
    if (!line.zones.some((zone) => candidate.zones.some((item) => norm(item) === norm(zone)))) continue;
    return line;
  }
  return null;
}

export function expandHrRateLines(
  lines: readonly HrRateLine[],
): Map<string, { item: string; rate: number; position: string }> {
  const map = new Map<string, { item: string; rate: number; position: string }>();
  for (const line of lines) {
    const project = line.project.trim();
    if (!project || !Number.isFinite(line.rate)) continue;
    for (const zone of line.zones) {
      const name = zone.trim();
      if (!name) continue;
      const nameOfVehicle = line.vehicleKey || line.vehicle;
      map.set(hrRateKey(line.vehicle, project, name, line.position ?? "", line.vehicleKey ?? ""), {
        item: [nameOfVehicle, project, name, line.position]
          .filter((part): part is string => Boolean(part && part.trim()))
          .join(" · "),
        rate: line.rate,
        position: (line.position ?? "").trim(),
      });
    }
  }
  return map;
}
