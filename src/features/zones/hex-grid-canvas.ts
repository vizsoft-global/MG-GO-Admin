import { cellToBoundary } from "h3-js";
import { ZONE_BLOCK_HEX_STYLE } from "./zone-blocks-layer";

/**
 * Shared canvas renderer for the block honeycomb.
 *
 * The whole grid is drawn as two paths — one for the background hexes and one
 * for the selection — instead of one map object per hex. That is what makes
 * ten thousand hexes affordable; the previous per-polygon approach fell over
 * around two thousand.
 */

/** Maps a lat/lng to canvas pixels. */
export type HexProjector = (lat: number, lng: number) => [number, number];

const WORLD_TILE_SIZE = 256;

function worldX(lng: number): number {
  return (lng + 180) / 360;
}

function worldY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

/**
 * Web Mercator projector anchored at the canvas top-left corner. Both Leaflet
 * and Google Maps use 256px Web Mercator tiles, so the same math drives both
 * without allocating a LatLng object per hex.
 */
export function createProjector(
  zoom: number,
  originLat: number,
  originLng: number,
): HexProjector {
  const scale = WORLD_TILE_SIZE * 2 ** zoom;
  const originX = worldX(originLng) * scale;
  const originY = worldY(originLat) * scale;
  return (lat, lng) => [worldX(lng) * scale - originX, worldY(lat) * scale - originY];
}

/**
 * `cellToBoundary` is a WASM call, so cache the rings. Cells stay stable while
 * panning and restyling, which is exactly when we redraw most often.
 */
const boundaryCache = new Map<string, number[]>();
const BOUNDARY_CACHE_LIMIT = 120_000;

/** Flat `[lat, lng, lat, lng, ...]` ring — avoids a nested array per hex. */
function cellRing(cell: string): number[] {
  const cached = boundaryCache.get(cell);
  if (cached) return cached;
  let flat: number[] = [];
  try {
    const ring = cellToBoundary(cell);
    flat = new Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) {
      flat[i * 2] = ring[i][0];
      flat[i * 2 + 1] = ring[i][1];
    }
  } catch {
    flat = [];
  }
  if (boundaryCache.size >= BOUNDARY_CACHE_LIMIT) boundaryCache.clear();
  boundaryCache.set(cell, flat);
  return flat;
}

function addCell(
  path: Path2D,
  cell: string,
  project: HexProjector,
  width: number,
  height: number,
  margin: number,
): boolean {
  const ring = cellRing(cell);
  if (ring.length < 6) return false;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const xs = new Array<number>(ring.length / 2);
  const ys = new Array<number>(ring.length / 2);
  for (let i = 0, p = 0; i < ring.length; i += 2, p++) {
    const [x, y] = project(ring[i], ring[i + 1]);
    xs[p] = x;
    ys[p] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // Cull hexes fully off-canvas; at wide zooms most of the grid is off-screen.
  if (maxX < -margin || minX > width + margin) return false;
  if (maxY < -margin || minY > height + margin) return false;

  path.moveTo(xs[0], ys[0]);
  for (let p = 1; p < xs.length; p++) path.lineTo(xs[p], ys[p]);
  path.closePath();
  return true;
}

type HexStyle = {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWeight: number;
};

/**
 * Hexes per Path2D.
 *
 * Path building degrades badly as a path grows — accumulating 48k hexes into a
 * single path costs ~9s, while the fill and stroke of that same path are
 * ~0ms. Flushing in small batches keeps the whole draw under ~50ms.
 */
const BATCH_SIZE = 256;

/** Off-canvas margin kept so partially visible hexes still draw their edges. */
const CULL_MARGIN = 64;

function drawBatched(
  ctx: CanvasRenderingContext2D,
  cells: readonly string[],
  style: HexStyle,
  project: HexProjector,
  width: number,
  height: number,
): void {
  let path = new Path2D();
  let pending = 0;

  const flush = () => {
    if (pending === 0) return;
    if (style.fillOpacity > 0) {
      ctx.globalAlpha = style.fillOpacity;
      ctx.fillStyle = style.fillColor;
      ctx.fill(path);
    }
    ctx.globalAlpha = style.strokeOpacity;
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = style.strokeWeight;
    ctx.stroke(path);
    path = new Path2D();
    pending = 0;
  };

  for (const cell of cells) {
    if (!addCell(path, cell, project, width, height, CULL_MARGIN)) continue;
    pending++;
    if (pending >= BATCH_SIZE) flush();
  }
  flush();
}

export type DrawHexGridArgs = {
  ctx: CanvasRenderingContext2D;
  /** CSS pixel size of the canvas. */
  width: number;
  height: number;
  cells: readonly string[];
  selected: ReadonlySet<string>;
  project: HexProjector;
  /** Hide the background grid but still draw the selection. */
  gridVisible?: boolean;
};

export function drawHexGrid({
  ctx,
  width,
  height,
  cells,
  selected,
  project,
  gridVisible = true,
}: DrawHexGridArgs): void {
  ctx.clearRect(0, 0, width, height);
  if (cells.length === 0) return;

  const background: string[] = [];
  const selection: string[] = [];
  for (const cell of cells) {
    if (selected.has(cell)) selection.push(cell);
    else if (gridVisible) background.push(cell);
  }

  // Background first so the selection always reads on top of it.
  drawBatched(
    ctx,
    background,
    ZONE_BLOCK_HEX_STYLE.unselected,
    project,
    width,
    height,
  );
  drawBatched(
    ctx,
    selection,
    ZONE_BLOCK_HEX_STYLE.selected,
    project,
    width,
    height,
  );

  ctx.globalAlpha = 1;
}

/** Sizes a canvas for the device pixel ratio and returns a CSS-pixel context. */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
