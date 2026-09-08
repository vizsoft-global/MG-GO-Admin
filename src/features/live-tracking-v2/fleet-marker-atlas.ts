/**
 * Sprite atlas for the WebGL driver layer.
 *
 * `IconLayer` wants one texture and a mapping, not 500 DOM nodes. The atlas is built
 * once from an SVG string, rasterised to a bitmap (see `loadFleetIconAtlas`) and cached,
 * so the texture uploads exactly once no matter how often layers rebuild.
 *
 * The marker is a **top-down vehicle tinted by status**, a V2-scoped divergence
 * from the teardrop-plus-glyph language on `/live-tracking` (documented in
 * `.cursor/rules/ui-system.mdc` §12). There is no disc or status ring: the bike,
 * car or van *is* the pin. Status is a per-cell luminance tint on the bike
 * PNG and the fill of the car SVG. The bike art is a north-facing PNG stamped at load
 * time — a nested `<image>` inside the SVG data URL would not decode. The crate
 * mark is `fleet-crate-logo.png` unless Settings supplies `driver_app_logo_url`.
 *
 * The sprite points **north**, because `getAngle` rotates the whole cell to the
 * driver's bearing. A selected rider scales up; it does not grow a ring.
 *
 * Sprites are laid out in a single row: one cell per (vehicle type × tone), then
 * the faded stale variants. Unmapped types use the bike cells — the same
 * fallback as the snapshot COALESCE.
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
export const FLEET_PIN_SIZE = 72;
export const FLEET_PIN_SELECTED_SCALE = 1.2;

const TONE_ORDER: readonly FleetTone[] = [
  "success",
  "primary",
  "warning",
  "danger",
  "neutral",
];

/**
 * Vehicle fills. Deliberately the semantic status ramp, not the coral data accent: on an
 * ops map red has to keep meaning danger, so coral is confined to routes and charts.
 */
export const FLEET_TONE_FILL: Record<FleetTone, string> = {
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
  | `pin-${KnownVehicleTypeKey}-${FleetTone}-stale`;

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

function pinTone(name: string): FleetTone {
  for (const tone of TONE_ORDER) {
    if (name.includes(`-${tone}`)) return tone;
  }
  return "neutral";
}

/**
 * Top-down car, north-facing. Body and cabin take the status fill; windows stay light
 * so a danger car is still a car, not a red blob.
 *
 * Built with `join` rather than `+` between template literals: Next's SWC minifier
 * mis-folds `` `…${C}…` + `…${C}…` `` and has already shipped a mangled atlas once.
 */
function carSprite(opacity: number, fill: string, cabin: string): string {
  return [
    `<g transform="translate(${C} ${C}) scale(1.08) translate(${-C} ${-C})"`,
    ` fill-opacity="${opacity}" stroke-opacity="${opacity}">`,
    `<rect x="16.6" y="11.2" width="14.8" height="25.6" rx="3.4" fill="${fill}"/>`,
    `<rect x="18.2" y="13.4" width="11.6" height="6.2" rx="1.6" fill="#93c5fd"/>`,
    `<rect x="18.4" y="21.2" width="11.2" height="8.4" rx="1.4" fill="${cabin}"/>`,
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
  tone: FleetTone,
): string {
  switch (type) {
    case "bike":
      return "";
    case "car":
      return carSprite(opacity, FLEET_TONE_FILL[tone], TONE_STROKE[tone]);
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
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
      push(vehicleCellBody(type, 1, tone));
    }
  }
  // Stale variants: same marker, faded, so a frozen driver reads as "was here" rather
  // than disappearing off the map mid-shift.
  for (const type of KNOWN_VEHICLE_TYPE_KEYS) {
    for (const tone of TONE_ORDER) {
      push(vehicleCellBody(type, 0.5, tone));
    }
  }

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

  return mapping;
}

const ATLAS_CELL_COUNT = TONE_ORDER.length * KNOWN_VEHICLE_TYPE_KEYS.length * 2;
const ATLAS_PIXEL_WIDTH = ATLAS_CELL_COUNT * CELL * SCALE;
const ATLAS_PIXEL_HEIGHT = CELL * SCALE;

/** What `IconLayer` is handed. See [loadFleetIconAtlas]. */
export type FleetIconAtlas = HTMLImageElement | ImageBitmap | HTMLCanvasElement;

/**
 * Every cell the mapping claims must actually carry ink.
 *
 * `IconLayer` has no complaint for an empty cell — it draws nothing, which is how a
 * mangled atlas reached production twice. One pass over the rasterised sheet turns
 * that into a named error. 1500px is well under a stamped bike / car and well over
 * a crate-logo-only cell, which is how a wiped bike used to pass this guard.
 */
const MIN_CELL_INK_PX = 1500;

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
const FLEET_CRATE_LOGO_URL = new URL("./assets/fleet-crate-logo.png", import.meta.url).href;

/** Device-pixel stamp. Fills the 96px cell so the vehicle, not empty padding, dominates. */
export const FLEET_BIKE_STAMP_PX = 88;
/** Source pixels of `fleet-bike-north.png`. */
export const FLEET_BIKE_ART_PX = 256;
/** Orange rear crate on that PNG — logo is contain-fitted inside this face. */
export const FLEET_BIKE_CRATE = { x: 89, y: 124, width: 78, height: 64 } as const;
/** Lid plate, toward the rider — crate-bbox centre sat on the tail. */
export const FLEET_BIKE_CRATE_PLATE = { cx: 128, cy: 146 } as const;
/** Longest logo side as a fraction of crate width. */
export const FLEET_BIKE_LOGO_CRATE_FIT = 0.5;
export const FLEET_ATLAS_REVISION = `v8-${FLEET_BIKE_STAMP_PX}-${FLEET_BIKE_LOGO_CRATE_FIT}-png`;

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

function toneRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

let bikeCellScratch: HTMLCanvasElement | null = null;

function bikeCellScratchCtx(width: number, height: number): CanvasRenderingContext2D {
  if (!bikeCellScratch) bikeCellScratch = document.createElement("canvas");
  if (bikeCellScratch.width !== width || bikeCellScratch.height !== height) {
    bikeCellScratch.width = width;
    bikeCellScratch.height = height;
  }
  const scratch = bikeCellScratch.getContext("2d", { willReadFrequently: true });
  if (!scratch) {
    throw new Error("fleet marker atlas: scratch 2d context unavailable");
  }
  scratch.setTransform(1, 0, 0, 1, 0, 0);
  scratch.globalAlpha = 1;
  scratch.globalCompositeOperation = "source-over";
  scratch.filter = "none";
  scratch.clearRect(0, 0, width, height);
  return scratch;
}

/**
 * Recolor ink in place from luminance so handlebars / crate / helmet stay
 * readable. A shared-canvas `source-atop` after every bike was stamped wiped
 * the vehicles on the map — only pulses and the crate mark remained.
 */
function colorizeScratch(ctx: CanvasRenderingContext2D, hex: string): void {
  const [tr, tg, tb] = toneRgb(hex);
  const image = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 8) continue;
    const lum = (0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)) / 255;
    const t = 0.28 + lum * 0.72;
    data[i] = tr * t;
    data[i + 1] = tg * t;
    data[i + 2] = tb * t;
  }
  ctx.putImageData(image, 0, 0);
}

export function stampFleetBikeSprites(
  ctx: CanvasRenderingContext2D,
  bike: CanvasImageSource,
): void {
  const size = FLEET_BIKE_STAMP_PX;
  for (const [name, cell] of Object.entries(fleetIconMapping())) {
    if (!name.startsWith("pin-bike-")) continue;
    const scratch = bikeCellScratchCtx(cell.width, cell.height);
    scratch.globalAlpha = name.endsWith("-stale") ? 0.5 : 1;
    scratch.drawImage(bike, (cell.width - size) / 2, (cell.height - size) / 2, size, size);
    scratch.globalAlpha = 1;
    colorizeScratch(scratch, FLEET_TONE_FILL[pinTone(name)]);
    ctx.drawImage(scratch.canvas, cell.x, cell.y);
  }
}

function logoNaturalSize(logo: CanvasImageSource): { w: number; h: number } {
  const withNatural = logo as { naturalWidth?: number; naturalHeight?: number; width: number; height: number };
  return {
    w: withNatural.naturalWidth || withNatural.width || 1,
    h: withNatural.naturalHeight || withNatural.height || 1,
  };
}

export function fleetBikeCrateLogoBox(
  cell: { x: number; y: number; width: number; height: number },
  logoW: number,
  logoH: number,
): { x: number; y: number; w: number; h: number } {
  const stamp = FLEET_BIKE_STAMP_PX;
  const scale = stamp / FLEET_BIKE_ART_PX;
  const originX = cell.x + (cell.width - stamp) / 2;
  const originY = cell.y + (cell.height - stamp) / 2;
  const crateCx = originX + FLEET_BIKE_CRATE_PLATE.cx * scale;
  const crateCy = originY + FLEET_BIKE_CRATE_PLATE.cy * scale;
  const maxW = FLEET_BIKE_CRATE.width * scale * FLEET_BIKE_LOGO_CRATE_FIT;
  const maxH = FLEET_BIKE_CRATE.height * scale * FLEET_BIKE_LOGO_CRATE_FIT;
  const aspect = logoW / Math.max(logoH, 1);
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { x: crateCx - w / 2, y: crateCy - h / 2, w, h };
}

export function stampFleetBikeLogos(
  ctx: CanvasRenderingContext2D,
  logo: CanvasImageSource,
  options?: { padFill?: string | null },
): void {
  const { w: logoW, h: logoH } = logoNaturalSize(logo);
  const inset = options?.padFill ? 1.5 : 0;
  const radius = 2;
  for (const [name, cell] of Object.entries(fleetIconMapping())) {
    if (!name.startsWith("pin-bike-")) continue;
    const box = fleetBikeCrateLogoBox(cell, logoW, logoH);
    ctx.save();
    ctx.globalAlpha = name.endsWith("-stale") ? 0.5 : 1;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, radius);
    if (options?.padFill) {
      ctx.fillStyle = options.padFill;
      ctx.fill();
    }
    ctx.clip();
    ctx.drawImage(logo, box.x + inset, box.y + inset, box.w - inset * 2, box.h - inset * 2);
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
 * A decoded `HTMLImageElement` from a PNG of the composed sheet is the value
 * `createTexture` is happiest with. Passing the live 2d canvas (especially one
 * created with `willReadFrequently`) or `createImageBitmap` of it made the
 * luminance-tinted bikes vanish on GoogleMapsOverlay — pulses and the crate
 * mark, drawn with `drawImage` rather than `putImageData`, still showed. PNG
 * encode/decode gives luma a straight bitmap; `updateState` sees a resolved
 * image on first pass, so this is not the string-URL path that never loaded.
 */
export function loadFleetIconAtlas(logoUrl?: string | null): Promise<FleetIconAtlas> {
  const key = `${FLEET_ATLAS_REVISION}:${logoUrl?.trim() ?? ""}`;
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
    tryLoadLogo(logoUrl ?? null),
    loadAtlasImage(FLEET_CRATE_LOGO_URL, "crate logo").catch(() => null),
  ]).then(async ([svgImage, bikeImage, remoteLogo, bundledLogo]) => {
    const logoImage = remoteLogo ?? bundledLogo;
    const padFill = remoteLogo ? "#ffffff" : null;
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
      stampFleetBikeLogos(ctx, logoImage, { padFill });
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
    const pngUrl = canvas.toDataURL("image/png");
    return loadAtlasImage(pngUrl, "composed png");
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
