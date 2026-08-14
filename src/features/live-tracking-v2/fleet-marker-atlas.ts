/**
 * Sprite atlas for the WebGL driver layer.
 *
 * `IconLayer` wants one texture and a mapping, not 500 DOM nodes. The atlas is built
 * once from an SVG string and decoded into an `Image`, which keeps the marker language
 * identical to the DOM markers on the existing page (§12: vehicle glyph inside a
 * colour-coded teardrop) without paying DOM cost per driver.
 *
 * Sprites are laid out in a single row: one teardrop per tone, then the shared
 * selection ring and heading chevron.
 */

import type { FleetTone } from "./fleet-status";

/** Device pixels per sprite. 2x so pins stay crisp on retina without a huge texture. */
const SCALE = 2;
const CELL_W = 44;
const CELL_H = 56;

export const FLEET_ICON_SIZE = { width: CELL_W, height: CELL_H };

const TONE_ORDER: readonly FleetTone[] = [
  "success",
  "primary",
  "warning",
  "danger",
  "neutral",
];

/**
 * Pin fills. Deliberately the semantic status ramp, not the coral data accent: on an
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
  | `pin-${FleetTone}`
  | `pin-${FleetTone}-stale`
  | "ring"
  | "heading";

export type FleetIconMapping = Record<
  string,
  { x: number; y: number; width: number; height: number; anchorX: number; anchorY: number; mask?: boolean }
>;

/** Teardrop body, anchored at the tip (22, 54). */
function teardrop(fill: string, stroke: string, opacity: number): string {
  return [
    `<path d="M22 54 C22 54 6 34.5 6 22 A16 16 0 1 1 38 22 C38 34.5 22 54 22 54 Z"`,
    ` fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2" stroke-opacity="${opacity}"/>`,
    `<circle cx="22" cy="21" r="12.5" fill="#ffffff" fill-opacity="${opacity * 0.95}"/>`,
  ].join("");
}

/**
 * Scooter glyph — the fleet is predominantly two-wheeler, and an unknown vehicle type
 * defaults to `bike` per §12 rather than being inferred from tracking status.
 */
function scooterGlyph(color: string, opacity: number): string {
  return [
    `<g stroke="${color}" stroke-opacity="${opacity}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none">`,
    `<circle cx="16.5" cy="25" r="3.1"/>`,
    `<circle cx="28" cy="25" r="3.1"/>`,
    `<path d="M19.6 25h5.3l-1.6-7.4h-3.1"/>`,
    `<path d="M23.3 17.6h3.4l1.3 7.4"/>`,
    `<path d="M25 15.4h2.6"/>`,
    `</g>`,
  ].join("");
}

function atlasSvg(): string {
  const cells: string[] = [];
  let x = 0;

  const push = (body: string) => {
    cells.push(`<g transform="translate(${x} 0)">${body}</g>`);
    x += CELL_W;
  };

  for (const tone of TONE_ORDER) {
    push(teardrop(TONE_FILL[tone], TONE_STROKE[tone], 1) + scooterGlyph(TONE_STROKE[tone], 1));
  }
  // Stale variants: same pin, faded, so a frozen driver reads as "was here" rather
  // than disappearing off the map mid-shift.
  for (const tone of TONE_ORDER) {
    push(
      teardrop(TONE_FILL[tone], TONE_STROKE[tone], 0.45) +
        scooterGlyph(TONE_STROKE[tone], 0.5),
    );
  }
  // Selection ring, drawn under the pin.
  push(
    `<circle cx="22" cy="28" r="19" fill="none" stroke="#ffffff" stroke-width="5" stroke-opacity="0.9"/>` +
      `<circle cx="22" cy="28" r="19" fill="none" stroke="#0f172a" stroke-width="2.5"/>`,
  );
  // Heading chevron, pointing up so `getAngle` can rotate it to the bearing.
  push(
    `<path d="M22 8 L28.5 20 L22 16.5 L15.5 20 Z" fill="#0f172a" fill-opacity="0.85" stroke="#ffffff" stroke-width="1.4"/>`,
  );

  const width = x;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SCALE}" height="${CELL_H * SCALE}" viewBox="0 0 ${width} ${CELL_H}">`,
    cells.join(""),
    `</svg>`,
  ].join("");
}

export function fleetIconMapping(): FleetIconMapping {
  const mapping: FleetIconMapping = {};
  let index = 0;

  const cell = (name: string, anchorY: number) => {
    mapping[name] = {
      x: index * CELL_W * SCALE,
      y: 0,
      width: CELL_W * SCALE,
      height: CELL_H * SCALE,
      anchorX: (CELL_W / 2) * SCALE,
      anchorY: anchorY * SCALE,
    };
    index += 1;
  };

  // Pins anchor at the tip; the ring and chevron anchor on the pin's head, which is
  // where they visually belong.
  for (const tone of TONE_ORDER) cell(`pin-${tone}`, CELL_H - 2);
  for (const tone of TONE_ORDER) cell(`pin-${tone}-stale`, CELL_H - 2);
  cell("ring", 28);
  cell("heading", 28);

  return mapping;
}

let atlasUrl: string | null = null;

/**
 * A data URL rather than a decoded `Image`: `IconLayer` accepts a URL and does its own
 * loading and texture upload, and the string is stable, so deck.gl uploads the atlas
 * exactly once no matter how often the layers are rebuilt.
 */
export function fleetIconAtlasUrl(): string {
  if (!atlasUrl) {
    atlasUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(atlasSvg())}`;
  }
  return atlasUrl;
}

export function fleetPinIcon(tone: FleetTone, stale: boolean): FleetIconName {
  return stale ? `pin-${tone}-stale` : `pin-${tone}`;
}
