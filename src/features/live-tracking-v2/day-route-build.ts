import type { EdgeArchivePoint } from "@/lib/fleet/edge-read";

/** Mirrors `functions/src/rpcs/day-route.ts`; both feed the same panel numbers. */
const EARTH_RADIUS_M = 6371008.8;
const MAX_ACCURACY_M = 50;
const MAX_SEGMENT_M = 500;
const MAX_SPEED_MPS = 40;
const STOP_RADIUS_M = 60;
const STOP_MIN_SECONDS = 180;

export type DayRoutePoint = {
  idx: number;
  latitude: number;
  longitude: number;
  speed_mps: number | null;
  battery_pct: number | null;
  accuracy_meters: number | null;
  heading_deg: number | null;
  tracking_status: string | null;
  zone_status: string | null;
  active_delivery_id: string | null;
  recorded_at: string;
  gap_before: boolean;
};

export type DayRouteStop = {
  latitude: number;
  longitude: number;
  arrived_at: string;
  departed_at: string;
  fixes: number;
  seconds: number;
};

export type DayRouteTrack = {
  points: DayRoutePoint[];
  stops: DayRouteStop[];
  sampled_distance_m: number;
  gap_distance_m: number;
  gap_seconds: number;
  gap_count: number;
  duration_s: number;
  point_count: number;
  kept_count: number;
};

type Work = {
  idx: number;
  lat: number;
  lng: number;
  t: number;
  src: EdgeArchivePoint;
  jumpsSoFar: number;
};

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function pointToSegmentMeters(p: Work, a: Work, b: Work): number {
  const refLat = toRadians((a.lat + b.lat) / 2);
  const mLat = 111132.92;
  const mLng = 111132.92 * Math.cos(refLat);
  const ax = a.lng * mLng;
  const ay = a.lat * mLat;
  const dx = b.lng * mLng - ax;
  const dy = b.lat * mLat - ay;
  const px = p.lng * mLng;
  const py = p.lat * mLat;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function simplify(points: Work[], tolerance: number): Work[] {
  if (points.length < 3 || tolerance <= 0) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    if (last - first < 2) continue;
    let maxDistance = 0;
    let maxIndex = -1;
    for (let index = first + 1; index < last; index += 1) {
      const distance = pointToSegmentMeters(points[index], points[first], points[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = index;
      }
    }
    if (maxIndex > -1 && maxDistance > tolerance) {
      keep[maxIndex] = true;
      stack.push([first, maxIndex], [maxIndex, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function deriveStops(points: Work[]): DayRouteStop[] {
  type Run = { sumLat: number; sumLng: number; fixes: number; from: number; to: number };
  const runs: Run[] = [];
  let current: Run | null = null;
  for (const point of points) {
    if (!current) {
      current = { sumLat: point.lat, sumLng: point.lng, fixes: 1, from: point.t, to: point.t };
      continue;
    }
    if (haversineMeters(current.sumLat / current.fixes, current.sumLng / current.fixes, point.lat, point.lng) > STOP_RADIUS_M) {
      runs.push(current);
      current = { sumLat: point.lat, sumLng: point.lng, fixes: 1, from: point.t, to: point.t };
      continue;
    }
    current.sumLat += point.lat;
    current.sumLng += point.lng;
    current.fixes += 1;
    current.to = point.t;
  }
  if (current) runs.push(current);
  return runs
    .map((run) => ({
      latitude: Math.round((run.sumLat / run.fixes) * 1e6) / 1e6,
      longitude: Math.round((run.sumLng / run.fixes) * 1e6) / 1e6,
      arrived_at: new Date(run.from).toISOString(),
      departed_at: new Date(run.to).toISOString(),
      fixes: run.fixes,
      seconds: Math.round((run.to - run.from) / 1000),
    }))
    .filter((stop) => stop.seconds >= STOP_MIN_SECONDS)
    .sort((a, b) => Date.parse(a.arrived_at) - Date.parse(b.arrived_at));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The polyline, jumps and stops of one rider-day, from R2 archive points. */
export function buildDayRouteTrack(archive: EdgeArchivePoint[], toleranceMeters = 8): DayRouteTrack {
  const series = archive
    .filter((point) => point.a == null || point.a <= MAX_ACCURACY_M)
    .slice()
    .sort((a, b) => a.t - b.t);

  const points: Work[] = series.map((src, index) => ({
    idx: index + 1,
    lat: src.la,
    lng: src.lo,
    t: src.t,
    src,
    jumpsSoFar: 0,
  }));

  let distance = 0;
  let gapDistance = 0;
  let gapSeconds = 0;
  let gapCount = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const meters = haversineMeters(previous.lat, previous.lng, current.lat, current.lng);
    const gapS = Math.max((current.t - previous.t) / 1000, 0.001);
    const isJump = meters > MAX_SEGMENT_M || meters / gapS > MAX_SPEED_MPS;
    if (isJump) {
      gapDistance += meters;
      gapSeconds += gapS;
      gapCount += 1;
    } else {
      distance += meters;
    }
    current.jumpsSoFar = previous.jumpsSoFar + (isJump ? 1 : 0);
  }

  const kept = simplify(points, points.length >= 3 ? Math.max(toleranceMeters, 0) : 0);
  let previousJumps = 0;
  const keptPoints = kept.map((point, index) => {
    const gapBefore = index > 0 && point.jumpsSoFar > previousJumps;
    previousJumps = point.jumpsSoFar;
    return {
      idx: point.idx,
      latitude: point.lat,
      longitude: point.lng,
      speed_mps: point.src.s,
      battery_pct: point.src.b,
      accuracy_meters: point.src.a,
      heading_deg: point.src.h,
      tracking_status: point.src.st || null,
      zone_status: null,
      active_delivery_id: point.src.ad ?? point.src.d ?? null,
      recorded_at: new Date(point.t).toISOString(),
      gap_before: gapBefore,
    };
  });

  const total = points.length;
  return {
    points: keptPoints,
    stops: deriveStops(points),
    sampled_distance_m: round2(distance),
    gap_distance_m: round2(gapDistance),
    gap_seconds: Math.round(gapSeconds),
    gap_count: gapCount,
    duration_s: total > 1 ? Math.max(0, Math.round((points[total - 1].t - points[0].t) / 1000)) : 0,
    point_count: total,
    kept_count: keptPoints.length,
  };
}
