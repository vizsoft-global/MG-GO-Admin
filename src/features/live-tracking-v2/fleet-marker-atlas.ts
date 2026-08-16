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
 *   keeps a red bike legible on a red `danger` ring.
 * - The sprite points **north**, because the whole point of a vehicle-shaped marker
 *   is that `getAngle` can rotate it to the driver's bearing. Ring and disc are
 *   rotationally symmetric, so baking them into the same cell as the bike costs
 *   nothing and saves a second `IconLayer` over 500 entities.
 *
 * Sprites are laid out in a single row: one cell per tone, the faded stale variants,
 * then the shared selection ring.
 */

import type { FleetTone } from "./fleet-status";

/** Device pixels per sprite. 2x so pins stay crisp on retina without a huge texture. */
const SCALE = 2;
const CELL = 48;

export const FLEET_ICON_SIZE = { width: CELL, height: CELL };

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

export type FleetIconName = `pin-${FleetTone}` | `pin-${FleetTone}-stale` | "ring";

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
 * Simplified top-down bike, traced from the supplied `topdown-bike.svg` and pointing
 * north (front wheel at the top).
 *
 * The source artwork carries mirrors, forearms and boots which turn to mush below
 * ~40px; at the 28-34px a 500-driver map actually renders, only the silhouette
 * survives, so this keeps the parts that read as "motorbike from above" — nose,
 * wide bars, tank, helmet, tapered tail, two dark tyres — and drops the rest.
 */
function bikeSprite(opacity: number): string {
  return [
    // Scaled up about the cell centre: at the ~28px a mid-zoom fleet renders at, the
    // untransformed artwork leaves dead space inside the disc and the silhouette
    // shrinks to a speck.
    `<g transform="translate(${C} ${C}) scale(1.12) translate(${-C} ${-C})"`,
    ` fill-opacity="${opacity}" stroke-opacity="${opacity}">`,
    // Front and rear tyres.
    `<rect x="22.4" y="10.2" width="3.2" height="6.2" rx="1.5" fill="#111827"/>`,
    `<rect x="22.3" y="31.6" width="3.4" height="6.6" rx="1.6" fill="#111827"/>`,
    // Tail, tapering to a point behind the rider.
    `<path d="M20.5 27.4h7l-1.2 7.2-2.3 3.1-2.3-3.1z" fill="#a01b16"/>`,
    // Nose / front fairing.
    `<path d="M24 10.9c-2.7 0-4.5 2.1-4.8 4.9l-.5 4.7h10.6l-.5-4.7c-.3-2.8-2.1-4.9-4.8-4.9z" fill="#d92b26"/>`,
    // Windscreen highlight — the one detail worth keeping, because it tells the eye
    // which end is the front even when the sprite is only ~30px tall.
    `<ellipse cx="24" cy="14.6" rx="2.6" ry="2.9" fill="#cbd5e1" fill-opacity="${opacity * 0.85}"/>`,
    // Handlebars and grips.
    `<rect x="14.8" y="17.4" width="18.4" height="2.3" rx="1.15" fill="#374151"/>`,
    `<rect x="14.2" y="16.6" width="3.4" height="3.9" rx="1.5" fill="#111827"/>`,
    `<rect x="30.4" y="16.6" width="3.4" height="3.9" rx="1.5" fill="#111827"/>`,
    // Tank.
    `<path d="M20.2 20.3h7.6l-.5 5.1h-6.6z" fill="#ef4444"/>`,
    // Rider: shoulders then helmet, drawn last so the helmet reads as the topmost
    // surface the way it does from directly above.
    `<ellipse cx="24" cy="27.6" rx="5.2" ry="3.9" fill="#b91c1c"/>`,
    `<circle cx="24" cy="24.3" r="3.9" fill="#475569"/>`,
    `<circle cx="24" cy="23.4" r="2.4" fill="#64748b" fill-opacity="${opacity * 0.9}"/>`,
    `</g>`,
  ].join("");
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

  for (const tone of TONE_ORDER) {
    push(statusPuck(TONE_FILL[tone], TONE_STROKE[tone], 1) + bikeSprite(1));
  }
  // Stale variants: same marker, faded, so a frozen driver reads as "was here" rather
  // than disappearing off the map mid-shift.
  for (const tone of TONE_ORDER) {
    push(
      statusPuck(TONE_FILL[tone], TONE_STROKE[tone], 0.45) + bikeSprite(0.5),
    );
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

  for (const tone of TONE_ORDER) cell(`pin-${tone}`);
  for (const tone of TONE_ORDER) cell(`pin-${tone}-stale`);
  cell("ring");

  return mapping;
}

const ATLAS_CELL_COUNT = TONE_ORDER.length * 2 + 1;
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
export function loadFleetIconAtlas(): Promise<FleetIconAtlas> {
  if (atlasImage) return Promise.resolve(atlasImage);
  if (atlasPromise) return atlasPromise;

  atlasPromise = new Promise<FleetIconAtlas>((resolve, reject) => {
    const svgImage = new Image();
    svgImage.width = ATLAS_PIXEL_WIDTH;
    svgImage.height = ATLAS_PIXEL_HEIGHT;
    svgImage.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = ATLAS_PIXEL_WIDTH;
        canvas.height = ATLAS_PIXEL_HEIGHT;
        // `willReadFrequently` because `assertAtlasCells` reads the sheet straight back;
        // without it Chrome warns in the console this feature asks operators to read.
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          reject(new Error("fleet marker atlas: 2d context unavailable"));
          return;
        }
        ctx.drawImage(svgImage, 0, 0, ATLAS_PIXEL_WIDTH, ATLAS_PIXEL_HEIGHT);
        assertAtlasCells(ctx);
        if (typeof createImageBitmap !== "function") {
          resolve(canvas);
          return;
        }
        createImageBitmap(canvas).then(resolve, () => resolve(canvas));
      } catch (error) {
        reject(
          error instanceof Error ? error : new Error("fleet marker atlas: rasterise failed"),
        );
      }
    };
    svgImage.onerror = () => reject(new Error("fleet marker atlas: svg decode failed"));
    svgImage.src = fleetIconAtlasUrl();
  }).then((image) => {
    atlasImage = image;
    return image;
  });

  return atlasPromise;
}

export function fleetPinIcon(tone: FleetTone, stale: boolean): FleetIconName {
  return stale ? `pin-${tone}-stale` : `pin-${tone}`;
}

/** Exposed for the preview harness in `scripts/preview-marker.mjs`. */
export function fleetAtlasSvgForPreview(): string {
  return atlasSvg();
}
