/**
 * Turning a day's fixes into something drawable.
 *
 * A route is not one polyline. `admin_get_driver_day_route` marks a point `gap_before`
 * when the path from the previous fix to it was never observed — the reporting stopped
 * and picked up somewhere else, whether over four hours in a dead-battery hole or in a
 * single second of provider noise. The straight line between those two fixes is the map
 * asserting a journey nobody recorded, and at city scale it is the most prominent thing
 * on the screen: a rider who crossed one block reads as one who crossed Kuwait.
 *
 * So the day is split into the runs that *were* observed, drawn as a route, and the
 * connectors across the holes, drawn as something that is visibly not one. The connectors
 * are kept rather than dropped because "the trace jumps here" is information an operator
 * needs — a route that simply restarts elsewhere looks like a rendering fault.
 */

export type FleetRoutePoint = {
  latitude: number;
  longitude: number;
  /** Set by the RPC when the segment arriving at this point was not observed travel. */
  gap_before?: boolean | null;
};

/** [lng, lat], GeoJSON order, as everything in this feature uses. */
export type FleetRouteGeometry = {
  /** Contiguous observed runs. Each is drawn as a solid route line. */
  segments: [number, number][][];
  /** Two-point connectors across a hole. Drawn dashed and grey. */
  gaps: [number, number][][];
};

export function splitRouteGeometry(
  points: readonly FleetRoutePoint[],
): FleetRouteGeometry | null {
  const segments: [number, number][][] = [];
  const gaps: [number, number][][] = [];

  let run: [number, number][] = [];
  let previous: [number, number] | null = null;

  const closeRun = () => {
    // A run of one draws nothing, but its point still anchors the gap either side of
    // it, and those were built from `previous` rather than from the run.
    if (run.length > 1) segments.push(run);
    run = [];
  };

  for (const point of points) {
    const position: [number, number] = [point.longitude, point.latitude];
    if (point.gap_before && previous) {
      closeRun();
      gaps.push([previous, position]);
    }
    run.push(position);
    previous = position;
  }
  closeRun();

  return segments.length > 0 || gaps.length > 0 ? { segments, gaps } : null;
}

/**
 * Every drawn coordinate, for framing the camera.
 *
 * Gap endpoints are included: they are places the rider was, so a day that ends across
 * town must still fit on screen even though the way there was never recorded.
 */
export function routeGeometryPositions(
  geometry: FleetRouteGeometry | null,
): [number, number][] {
  if (!geometry) return [];
  const all: [number, number][] = [];
  for (const segment of geometry.segments) all.push(...segment);
  for (const gap of geometry.gaps) all.push(...gap);
  return all;
}
