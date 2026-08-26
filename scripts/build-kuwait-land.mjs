/**
 * Regenerates src/lib/geo/kuwait-land-data.ts from the geoBoundaries Kuwait ADM0
 * boundary (OpenStreetMap derived, includes Failaka / Bubiyan / Warbah).
 *
 *   node scripts/build-kuwait-land.mjs
 *
 * Output is committed; this only needs re-running when the source boundary changes.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  area,
  bbox,
  booleanPointInPolygon,
  featureCollection,
  intersect,
  multiPolygon,
  point,
  polygon,
  simplify,
} from "@turf/turf";
import { cellToBoundary, cellToLatLng, polygonToCells } from "h3-js";

const SOURCE =
  "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/KWT/ADM0/geoBoundaries-KWT-ADM0.geojson";

/** ~50 m of coastline detail — finer than a res-10 hex (~152 m across). */
const SIMPLIFY_TOLERANCE = 0.0005;
const COORD_PRECISION = 5;

/** Coarse index resolution. ~36 km² per cell → a few hundred cells for Kuwait. */
const INDEX_RES = 6;

/** A cell counts as fully-land when this much of it is inside the boundary. */
const FULL_LAND_RATIO = 0.9995;

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "src", "lib", "geo", "kuwait-land-data.ts");

function round(n) {
  return Number(n.toFixed(COORD_PRECISION));
}

async function main() {
  process.stdout.write(`Fetching ${SOURCE}\n`);
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  const fc = await res.json();

  const geom = fc.features[0].geometry;
  const rawCoords =
    geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const rawArea = area(multiPolygon(rawCoords)) / 1e6;

  const simplified = simplify(multiPolygon(rawCoords), {
    tolerance: SIMPLIFY_TOLERANCE,
    highQuality: true,
    mutate: true,
  });
  const coords = simplified.geometry.coordinates.map((poly) =>
    poly.map((ring) => ring.map(([lng, lat]) => [round(lng), round(lat)])),
  );
  const land = multiPolygon(coords);
  const landArea = area(land) / 1e6;
  const points = coords.reduce(
    (acc, poly) => acc + poly.reduce((a, ring) => a + ring.length, 0),
    0,
  );
  process.stdout.write(
    `Simplified: ${coords.length} polygons, ${points} points, ` +
      `${landArea.toFixed(1)} km² (source ${rawArea.toFixed(1)} km²)\n`,
  );

  // Every res-6 cell that could touch Kuwait: cells centred in the bbox, which
  // comfortably covers the boundary plus a margin.
  const [west, south, east, north] = bbox(land);
  const pad = 0.15;
  const bboxRing = [
    [west - pad, south - pad],
    [east + pad, south - pad],
    [east + pad, north + pad],
    [west - pad, north + pad],
    [west - pad, south - pad],
  ];
  const candidates = polygonToCells([bboxRing], INDEX_RES, true);
  process.stdout.write(
    `Classifying ${candidates.length} res-${INDEX_RES} cells...\n`,
  );

  const full = [];
  const edge = [];
  let sea = 0;
  for (const cell of candidates) {
    const ring = cellToBoundary(cell, true);
    ring.push(ring[0]);
    const hex = polygon([ring]);
    const hexArea = area(hex);
    let overlap = 0;
    try {
      const clipped = intersect(featureCollection([land, hex]));
      overlap = clipped ? area(clipped) : 0;
    } catch {
      // Degenerate clip — treat as a coastal cell so runtime falls back to the
      // exact point-in-polygon test rather than silently dropping land.
      edge.push(cell);
      continue;
    }
    const ratio = hexArea > 0 ? overlap / hexArea : 0;
    if (ratio >= FULL_LAND_RATIO) full.push(cell);
    else if (ratio > 0) edge.push(cell);
    else sea += 1;
  }
  process.stdout.write(
    `  full-land ${full.length} | coastal ${edge.length} | sea ${sea}\n`,
  );

  // Sanity: every full-land cell centre must read as land.
  for (const cell of full) {
    const [lat, lng] = cellToLatLng(cell);
    if (!booleanPointInPolygon(point([lng, lat]), land)) {
      throw new Error(`full-land cell ${cell} centre is not inside boundary`);
    }
  }

  const body = `// GENERATED FILE — do not edit by hand.
// Run \`node scripts/build-kuwait-land.mjs\` to regenerate.
//
// Source: geoBoundaries gbOpen KWT ADM0 (OpenStreetMap / Wambacher), simplified
// to ~${Math.round(SIMPLIFY_TOLERANCE * 111000)} m. Includes Failaka, Bubiyan and Warbah.
// ${coords.length} polygons, ${points} points, ${landArea.toFixed(1)} km².

import type { Position } from "geojson";

export const KUWAIT_LAND_COORDINATES: Position[][][] = ${JSON.stringify(coords)};

/** Resolution of the coarse land index below. */
export const KUWAIT_LAND_INDEX_RES = ${INDEX_RES};

/** Res-${INDEX_RES} cells lying entirely inside Kuwait — children need no geometry test. */
export const KUWAIT_LAND_FULL_CELLS: string[] = ${JSON.stringify(full)};

/** Res-${INDEX_RES} cells straddling the coast or border — children need an exact test. */
export const KUWAIT_LAND_EDGE_CELLS: string[] = ${JSON.stringify(edge)};
`;

  writeFileSync(OUT, body);
  process.stdout.write(
    `Wrote ${OUT} (${(body.length / 1024).toFixed(0)} KB)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
});
