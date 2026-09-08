/**
 * Sprite atlas for the WebGL driver layer.
 *
 * `IconLayer` wants one texture and a mapping, not 500 DOM nodes. The atlas is built
 * once from an SVG string, rasterised to a bitmap (see `loadFleetIconAtlas`) and cached,
 * so the texture uploads exactly once no matter how often layers rebuild.
 *
 * The marker is a **top-down bike on a status ring**, which is a deliberate,
 * V2-scoped divergence from the teardrop-plus-glyph language on `/live-tracking`
 * (documented in `.cursor/rules/ui-system.mdc` §12). Two constraints forced the
 * shape:
 *
 * - The bike is drawn in its own colours, so it cannot also carry status. Status
 *   lives on the ring around it and the bike sits on a light disc, which is what
 *   keeps the orange bike legible on a red `danger` ring. The bike art is a
 *   north-facing PNG stamped at load time — a nested `<image>` inside the SVG
 *   data URL would not decode.
 * - The sprite points **north**, because the whole point of a vehicle-shaped marker
 *   is that `getAngle` can rotate it to the driver's bearing. Ring and disc are
 *   rotationally symmetric, so baking them into the same cell as the bike costs
 *   nothing and saves a second `IconLayer` over 500 entities.
 *
 * Sprites are laid out in a single row: one cell per (vehicle type × tone), the
 * faded stale variants, then the shared selection ring. Unmapped types use the
 * bike cells — the same fallback as the snapshot COALESCE.
 */

import {
  KNOWN_VEHICLE_TYPE_KEYS,
  vehicleSpriteKey,
  type KnownVehicleTypeKey,
} from "../vehicles/vehicle-type";
import type { FleetTone } from "./fleet-status";

/** Device pixels per sprite. 2x so pins stay crisp on retina without a huge texture. */
const SCALE = 2;
const CELL = 48;

export const FLEET_ICON_SIZE = { width: CELL, height: CELL };
/** Screen pixels. Atlas cell stays 48; the layer draws larger so the bike reads. */
export const FLEET_PIN_SIZE = 56;
export const FLEET_PIN_SELECTED_SCALE = 1.2;

const TONE_ORDER: readonly FleetTone[] = [
  "success",
  "primary",
  "warning",
  "danger",
  "neutral",
];

/**
 * Ring fills. Deliberately the semantic status ramp, not the coral data accent: on an
 * ops map red has to keep meaning danger, so coral is confined to routes and charts.
 */
const TONE_FILL: Record<FleetTone, string> = {
  success: "#10b981",
  primary: "#3b82f6",
  warning: "#f59e0b",
  danger: "#f43f5e",
  neutral: "#64748b",
};

const TONE_STROKE: Record<FleetTone, string> = {
  success: "#047857",
  primary: "#1d4ed8",
  warning: "#b45309",
  danger: "#be123c",
  neutral: "#334155",
};

export type FleetIconName =
  | `pin-${KnownVehicleTypeKey}-${FleetTone}`
  | `pin-${KnownVehicleTypeKey}-${FleetTone}-stale`
  | "ring";

export type FleetIconMapping = Record<
  string,
  {
    x: number;
    y: number;
    width: number;
    height: number;
    anchorX: number;
    anchorY: number;
    mask?: boolean;
  }
>;

const C = CELL / 2;

/**
 * Status ring plus the light disc the bike sits on.
 *
 * The disc is near-white rather than transparent on purpose: over satellite imagery
 * or a dark basemap the bike's own dark tyres and helmet would otherwise disappear.
 */
function statusPuck(fill: string, stroke: string, opacity: number): string {
  return [
    `<circle cx="${C}" cy="${C}" r="22" fill="${fill}" fill-opacity="${opacity}"`,
    ` stroke="${stroke}" stroke-width="1.6" stroke-opacity="${opacity}"/>`,
    `<circle cx="${C}" cy="${C}" r="17.2" fill="#f8fafc" fill-opacity="${opacity * 0.97}"/>`,
  ].join("");
}

/**
 * Top-down car, north-facing. Same cell contract as the bike: status lives on the
 * puck, the body is its own colour so a danger ring cannot swallow it.
 */
function carSprite(opacity: number): string {
  return [
    `<g transform="translate(${C} ${C}) scale(1.08) translate(${-C} ${-C})"`,
    ` fill-opacity="${opacity}" stroke-opacity="${opacity}">`,
    `<rect x="16.6" y="11.2" width="14.8" height="25.6" rx="3.4" fill="#1d4ed8"/>`,
    `<rect x="18.2" y="13.4" width="11.6" height="6.2" rx="1.6" fill="#93c5fd"/>`,
    `<rect x="18.4" y="21.2" width="11.2" height="8.4" rx="1.4" fill="#1e3a8a"/>`,
    `<rect x="18.6" y="30.6" width="10.8" height="3.4" rx="1" fill="#64748b"/>`,
    `<rect x="15.2" y="16.8" width="2.2" height="5.4" rx="1" fill="#111827"/>`,
    `<rect x="30.6" y="16.8" width="2.2" height="5.4" rx="1" fill="#111827"/>`,
    `<rect x="15.2" y="26.4" width="2.2" height="5.4" rx="1" fill="#111827"/>`,
    `<rect x="30.6" y="26.4" width="2.2" height="5.4" rx="1" fill="#111827"/>`,
    `<rect x="18.6" y="12.2" width="3.2" height="1.3" rx="0.5" fill="#fde68a"/>`,
    `<rect x="26.2" y="12.2" width="3.2" height="1.3" rx="0.5" fill="#fde68a"/>`,
    `</g>`,
  ].join("");
}

function vehicleCellBody(
  type: KnownVehicleTypeKey,
  opacity: number,
  puck: string,
): string {
  switch (type) {
    case "bike":
      return puck;
    case "car":
      return puck + carSprite(opacity);
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/**
 * Selection ring, drawn under the marker. Sized outside the status ring so both stay
 * readable at once.
 *
 * Built with `join` rather than `+` for a reason that is not style. Next's SWC minifier
 * mis-folds `` `…${C}…` + `…${C}…` `` — it drops the static tail of the first literal and
 * splices the second in, so this cell shipped to production as
 * `<circle cx="24" cy="24<circle cx="24" …`. That is malformed XML, the *whole* atlas SVG
 * then fails to decode, and every rider renders as the bare status puck. Concatenating
 * with `+` is only safe here between function calls, which the minifier cannot fold.
 */
function selectionRing(): string {
  return [
    `<circle cx="${C}" cy="${C}" r="23" fill="none" stroke="#ffffff" stroke-width="5" stroke-opacity="0.9"/>`,
    `<circle cx="${C}" cy="${C}" r="23" fill="none" stroke="#0f172a" stroke-width="2.5"/>`,
  ].join("");
}

function atlasSvg(): string {
  const cells: string[] = [];
  let x = 0;

  const push = (body: string) => {
    cells.push(`<g transform="translate(${x} 0)">${body}</g>`);
    x += CELL;
  };

  for (const type of KNOWN_VEHICLE_TYPE_KEYS) {
    for (const tone of TONE_ORDER) {
      push(vehicleCellBody(type, 1, statusPuck(TONE_FILL[tone], TONE_STROKE[tone], 1)));
    }
  }
  // Stale variants: same marker, faded, so a frozen driver reads as "was here" rather
  // than disappearing off the map mid-shift.
  for (const type of KNOWN_VEHICLE_TYPE_KEYS) {
    for (const tone of TONE_ORDER) {
      push(vehicleCellBody(type, 0.5, statusPuck(TONE_FILL[tone], TONE_STROKE[tone], 0.45)));
    }
  }
  push(selectionRing());

  const width = x;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SCALE}" height="${CELL * SCALE}" viewBox="0 0 ${width} ${CELL}">`,
    cells.join(""),
    `</svg>`,
  ].join("");
}

export function fleetIconMapping(): FleetIconMapping {
  const mapping: FleetIconMapping = {};
  let index = 0;

  const cell = (name: string) => {
    mapping[name] = {
      x: index * CELL * SCALE,
      y: 0,
      width: CELL * SCALE,
      height: CELL * SCALE,
      // Centre anchor, not the old teardrop tip: a rotating marker has to turn about
      // the driver's actual position, or it would swing around a point 26px away.
      anchorX: C * SCALE,
      anchorY: C * SCALE,
    };
    index += 1;
  };

  for (const type of KNOWN_VEHICLE_TYPE_KEYS) {
    for (const tone of TONE_ORDER) cell(`pin-${type}-${tone}`);
  }
  for (const type of KNOWN_VEHICLE_TYPE_KEYS) {
    for (const tone of TONE_ORDER) cell(`pin-${type}-${tone}-stale`);
  }
  cell("ring");

  return mapping;
}

const ATLAS_CELL_COUNT = TONE_ORDER.length * KNOWN_VEHICLE_TYPE_KEYS.length * 2 + 1;
const ATLAS_PIXEL_WIDTH = ATLAS_CELL_COUNT * CELL * SCALE;
const ATLAS_PIXEL_HEIGHT = CELL * SCALE;

/** What `IconLayer` is handed. See [loadFleetIconAtlas]. */
export type FleetIconAtlas = ImageBitmap | HTMLCanvasElement;

/**
 * Every cell the mapping claims must actually carry ink.
 *
 * `IconLayer` has no complaint for an empty cell — it draws nothing and the scatterplot
 * puck underneath keeps the marker looking plausible, which is how a mangled atlas reached
 * production twice. One pass over the rasterised sheet turns that into a named error.
 * 200px is well under the ~1.6k the thinnest cell (the ring) covers and well over
 * anti-aliasing noise.
 */
const MIN_CELL_INK_PX = 200;

function assertAtlasCells(ctx: CanvasRenderingContext2D): void {
  const mapping = fleetIconMapping();
  const blank: string[] = [];

  for (const [name, cell] of Object.entries(mapping)) {
    const { data } = ctx.getImageData(cell.x, cell.y, cell.width, cell.height);
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! > 8) ink += 1;
    }
    if (ink < MIN_CELL_INK_PX) blank.push(`${name}(${ink}px)`);
  }

  if (blank.length > 0) {
    throw new Error(`fleet marker atlas: blank sprite cells — ${blank.join(", ")}`);
  }
}

let atlasUrl: string | null = null;
let atlasImage: FleetIconAtlas | null = null;
let atlasPromise: Promise<FleetIconAtlas> | null = null;
let atlasCacheKey: string | null = null;

const FLEET_BIKE_SPRITE_URL = new URL("./assets/fleet-bike-north.png", import.meta.url).href;

/** Device-pixel stamp. Slightly larger than the disc so the bike, not the ring, dominates. */
export const FLEET_BIKE_STAMP_PX = 72;
/** White pad on the rear crate, device pixels. */
export const FLEET_BIKE_LOGO_PAD_PX = 16;
/** Below cell centre, as a fraction of the stamp — the box sits at the tail. */
export const FLEET_BIKE_LOGO_OFFSET = 0.28;

function loadAtlasImage(
  src: string,
  label: string,
  size?: { width: number; height: number },
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (size) {
      image.width = size.width;
      image.height = size.height;
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`fleet marker atlas: ${label} decode failed`));
    image.src = src;
  });
}

function tryLoadLogo(src: string | null): Promise<HTMLImageElement | null> {
  const url = src?.trim();
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export function stampFleetBikeSprites(
  ctx: CanvasRenderingContext2D,
  bike: CanvasImageSource,
): void {
  const size = FLEET_BIKE_STAMP_PX;
  for (const [name, cell] of Object.entries(fleetIconMapping())) {
    if (!name.startsWith("pin-bike-")) continue;
    ctx.save();
    ctx.globalAlpha = name.endsWith("-stale") ? 0.5 : 1;
    ctx.drawImage(
      bike,
      cell.x + (cell.width - size) / 2,
      cell.y + (cell.height - size) / 2,
      size,
      size,
    );
    ctx.restore();
  }
}

export function stampFleetBikeLogos(
  ctx: CanvasRenderingContext2D,
  logo: CanvasImageSource,
): void {
  const stamp = FLEET_BIKE_STAMP_PX;
  const pad = FLEET_BIKE_LOGO_PAD_PX;
  const inset = 2;
  const radius = 3;
  for (const [name, cell] of Object.entries(fleetIconMapping())) {
    if (!name.startsWith("pin-bike-")) continue;
    const cx = cell.x + cell.width / 2;
    const cy = cell.y + cell.height / 2 + stamp * FLEET_BIKE_LOGO_OFFSET;
    const x = cx - pad / 2;
    const y = cy - pad / 2;
    ctx.save();
    ctx.globalAlpha = name.endsWith("-stale") ? 0.5 : 1;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(x, y, pad, pad, radius);
    ctx.fill();
    ctx.drawImage(logo, x + inset, y + inset, pad - inset * 2, pad - inset * 2);
    ctx.restore();
  }
}

/**
 * SVG data URL for HTML preview only. Do not pass this to deck.gl — loaders.gl's
 * image loader does not decode SVG, so IconLayer would upload an empty texture and
 * every rider pin would be invisible.
 */
export function fleetIconAtlasUrl(): string {
  if (!atlasUrl) {
    atlasUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(atlasSvg())}`;
  }
  return atlasUrl;
}

/**
 * Decoded bitmap for `IconLayer`.
 *
 * Deliberately **not** a URL, even though a PNG data URL is the documented form.
 * `iconAtlas` is an async prop of type `image`: a string is handed to loaders.gl to fetch
 * and decode, and `IconLayer.updateState` returns early for as long as the prop is still
 * a string, so nothing at all draws from the atlas until that resolves. On Vercel it
 * never did — the markers were plain coloured discs, which is the `fleet-driver-pucks`
 * scatterplot that draws underneath, not a sprite that lost its bike. Which link of
 * fetch → decode → texture broke there was never isolated, and this removes the whole
 * chain rather than guessing.
 *
 * A decoded `ImageBitmap` (or the canvas itself, where `createImageBitmap` is missing) is
 * a resolved value: deck's image prop transform wraps it as `{data}` and calls
 * `device.createTexture`, which takes any `ExternalImage`. No fetch, no base64
 * round-trip, no loader registry, and `updateState` sees a usable atlas on first pass.
 */
export function loadFleetIconAtlas(logoUrl?: string | null): Promise<FleetIconAtlas> {
  const key = logoUrl?.trim() ?? "";
  if (atlasImage && atlasCacheKey === key) return Promise.resolve(atlasImage);
  if (atlasPromise && atlasCacheKey === key) return atlasPromise;

  atlasCacheKey = key;
  atlasImage = null;
  atlasPromise = Promise.all([
    loadAtlasImage(fleetIconAtlasUrl(), "svg", {
      width: ATLAS_PIXEL_WIDTH,
      height: ATLAS_PIXEL_HEIGHT,
    }),
    loadAtlasImage(FLEET_BIKE_SPRITE_URL, "bike png"),
    tryLoadLogo(key || null),
  ]).then(async ([svgImage, bikeImage, logoImage]) => {
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_PIXEL_WIDTH;
    canvas.height = ATLAS_PIXEL_HEIGHT;
    // `willReadFrequently` because `assertAtlasCells` reads the sheet straight back;
    // without it Chrome warns in the console this feature asks operators to read.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("fleet marker atlas: 2d context unavailable");
    }
    ctx.drawImage(svgImage, 0, 0, ATLAS_PIXEL_WIDTH, ATLAS_PIXEL_HEIGHT);
    stampFleetBikeSprites(ctx, bikeImage);
    if (logoImage) {
      stampFleetBikeLogos(ctx, logoImage);
      try {
        assertAtlasCells(ctx);
      } catch {
        ctx.clearRect(0, 0, ATLAS_PIXEL_WIDTH, ATLAS_PIXEL_HEIGHT);
        ctx.drawImage(svgImage, 0, 0, ATLAS_PIXEL_WIDTH, ATLAS_PIXEL_HEIGHT);
        stampFleetBikeSprites(ctx, bikeImage);
        assertAtlasCells(ctx);
      }
    } else {
      assertAtlasCells(ctx);
    }
    if (typeof createImageBitmap !== "function") {
      return canvas;
    }
    try {
      return await createImageBitmap(canvas);
    } catch {
      return canvas;
    }
  }).then((image) => {
    if (atlasCacheKey === key) atlasImage = image;
    return image;
  }).catch((error: unknown) => {
    if (atlasCacheKey === key) {
      atlasPromise = null;
      atlasCacheKey = null;
    }
    throw error;
  });

  return atlasPromise;
}

export function fleetPinIcon(
  tone: FleetTone,
  stale: boolean,
  vehicleTypeKey?: string | null,
): FleetIconName {
  const type = vehicleSpriteKey(vehicleTypeKey);
  return stale ? `pin-${type}-${tone}-stale` : `pin-${type}-${tone}`;
}

/** Exposed for the preview harness in `scripts/preview-marker.mjs`. */
export function fleetAtlasSvgForPreview(): string {
  return atlasSvg();
}
