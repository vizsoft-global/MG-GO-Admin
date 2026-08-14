/**
 * Renders the fleet marker atlas into a throwaway HTML page so the sprite can be
 * judged at the sizes it actually ships at, rotated, and over both a light and a dark
 * basemap. Marker legibility is a pixel question, not a code-review question.
 *
 * Usage: node --import tsx scripts/preview-marker.mjs <outDir>
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  fleetAtlasSvgForPreview,
  fleetIconMapping,
  FLEET_ICON_SIZE,
} from "../src/features/live-tracking-v2/fleet-marker-atlas.ts";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node --import tsx scripts/preview-marker.mjs <outDir>");
  process.exit(1);
}

const svg = fleetAtlasSvgForPreview();
const mapping = fleetIconMapping();
const atlasUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** One sprite cropped out of the atlas via background-position. */
function sprite(name, px, angle = 0) {
  const cell = mapping[name];
  // The atlas cells are already in device pixels (2x), so the display scale is
  // relative to `cell.width`, not to the logical icon size.
  const scale = px / cell.width;
  const sheetW = Object.keys(mapping).length * cell.width;
  return `<span style="
    display:inline-block;width:${px}px;height:${px}px;
    background-image:url('${atlasUrl}');
    background-size:${sheetW * scale}px ${cell.height * scale}px;
    background-position:-${cell.x * scale}px 0;
    transform:rotate(${angle}deg);
  "></span>`;
}

const tones = ["success", "primary", "warning", "danger", "neutral"];

const html = `<!doctype html>
<meta charset="utf-8">
<title>fleet marker preview</title>
<style>
  body { font: 12px ui-sans-serif, system-ui; margin: 0; padding: 20px; background: #f1f5f9; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #475569; margin: 22px 0 8px; }
  .row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .dark { background: #0f172a; padding: 14px; border-radius: 10px; }
  .sat { background: #6b705c; padding: 14px; border-radius: 10px; }
  .cap { color: #64748b; width: 100%; margin-top: 4px; }
  .atlas { background: #fff; border: 1px solid #cbd5e1; }
</style>

<h2>Ships at these sizes (48 / 36 / 28 px)</h2>
<div class="row">
  ${[48, 36, 28].map((px) => tones.map((t) => sprite(`pin-${t}`, px)).join("")).join('<span style="width:14px"></span>')}
</div>

<h2>Rotation — 0 / 45 / 90 / 135 / 180 / 225 / 270 / 315</h2>
<div class="row">
  ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => sprite("pin-primary", 40, a)).join("")}
</div>

<h2>Stale variants (36px)</h2>
<div class="row">${tones.map((t) => sprite(`pin-${t}-stale`, 36)).join("")}</div>

<h2>Over a dark basemap / satellite</h2>
<div class="row">
  <div class="dark">${tones.map((t) => sprite(`pin-${t}`, 36)).join("")}</div>
  <div class="sat">${tones.map((t) => sprite(`pin-${t}`, 36)).join("")}</div>
</div>

<h2>Selection ring behind the marker (40px)</h2>
<div class="row">
  <span style="position:relative;display:inline-block;width:48px;height:48px">
    <span style="position:absolute;inset:0">${sprite("ring", 48)}</span>
    <span style="position:absolute;inset:4px">${sprite("pin-success", 40)}</span>
  </span>
</div>

<h2>Density check — 60 markers at 30px</h2>
<div class="row" style="gap:2px;max-width:520px">
  ${Array.from({ length: 60 }, (_, i) => sprite(`pin-${tones[i % tones.length]}`, 30, (i * 37) % 360)).join("")}
</div>

<h2>Raw atlas sheet</h2>
<img class="atlas" src="${atlasUrl}" alt="atlas">
`;

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "index.html"), html, "utf8");
console.log(`wrote ${join(outDir, "index.html")}`);
