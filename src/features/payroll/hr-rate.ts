export const HR_VEHICLES = ["Bike", "Car"] as const;

export type HrVehicleType = (typeof HR_VEHICLES)[number];

export type HrRateLine = {
  id: string;
  vehicle: HrVehicleType;
  project: string;
  zones: string[];
  rate: number;
};

export type HrRateHit = {
  vehicle: HrVehicleType;
  project: string;
  zone: string;
  rate: number;
};

export type HrRateEvent = {
  id: string;
  at: string;
  by: string;
  item: string;
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

export function matchHrRates(input: {
  vehicleKey: string | null | undefined;
  projects: readonly string[];
  zone: string;
  lines: readonly HrRateLine[];
}): HrRateHit[] {
  const vehicle = hrVehicleFromKey(input.vehicleKey);
  const zone = norm(input.zone);
  const projects = new Set(input.projects.map(norm).filter(Boolean));
  if (!zone || projects.size === 0) return [];
  const hits: HrRateHit[] = [];
  for (const line of input.lines) {
    if (line.vehicle !== vehicle) continue;
    if (!projects.has(norm(line.project))) continue;
    if (!line.zones.some((item) => norm(item) === zone)) continue;
    if (!Number.isFinite(line.rate)) continue;
    hits.push({
      vehicle: line.vehicle,
      project: line.project.trim(),
      zone: input.zone.trim(),
      rate: line.rate,
    });
  }
  return hits;
}

export function hrRateLabel(hits: readonly HrRateHit[], missing = HR_NO_RATE): string {
  if (hits.length === 0) return missing;
  return hits.map((hit) => hit.rate.toFixed(3)).join(" · ");
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

export function hrRateKey(vehicle: string, project: string, zone: string): string {
  return `${norm(vehicle)}|${norm(project)}|${norm(zone)}`;
}

export function expandHrRateLines(lines: readonly HrRateLine[]): Map<string, { item: string; rate: number }> {
  const map = new Map<string, { item: string; rate: number }>();
  for (const line of lines) {
    const project = line.project.trim();
    if (!project || !Number.isFinite(line.rate)) continue;
    for (const zone of line.zones) {
      const name = zone.trim();
      if (!name) continue;
      map.set(hrRateKey(line.vehicle, project, name), {
        item: `${line.vehicle} · ${project} · ${name}`,
        rate: line.rate,
      });
    }
  }
  return map;
}
