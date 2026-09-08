/**
 * Renders the fleet marker atlas into a throwaway HTML page so the sprite can be
 * judged at the sizes it actually ships at, rotated, and over both a light and a dark
 * basemap. Marker legibility is a pixel question, not a code-review question.
 *
 * Usage: node --import tsx scripts/preview-marker.mjs <outDir>
 */

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FLEET_BIKE_STAMP_PX,
  fleetAtlasSvgForPreview,
  fleetIconMapping,
} from "../src/features/live-tracking-v2/fleet-marker-atlas.ts";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: node --import tsx scripts/preview-marker.mjs <outDir>");
  process.exit(1);
}

const svg = fleetAtlasSvgForPreview();
const mapping = fleetIconMapping();
const atlasUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const bikePng = fileURLToPath(
  new URL("../src/features/live-tracking-v2/assets/fleet-bike-north.png", import.meta.url),
);

const html = `<!doctype html>
<meta charset="utf-8">
<title>fleet marker preview</title>
<style>
  body { font: 12px ui-sans-serif, system-ui; margin: 0; padding: 20px; background: #f1f5f9; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #475569; margin: 22px 0 8px; }
  .row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .dark { background: #0f172a; padding: 14px; border-radius: 10px; }
  .sat { background: #6b705c; padding: 14px; border-radius: 10px; }
  .atlas { background: #fff; border: 1px solid #cbd5e1; max-width: 100%; }
</style>
<div id="root">Composing atlas…</div>
<script type="module">
const mapping = ${JSON.stringify(mapping)};
const stampPx = ${FLEET_BIKE_STAMP_PX};
const tones = ["success", "primary", "warning", "danger", "neutral"];

function load(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

function sprite(atlasUrl, name, px, angle = 0) {
  const cell = mapping[name];
  const scale = px / cell.width;
  const sheetW = Object.keys(mapping).length * cell.width;
  return \`<span style="
    display:inline-block;width:\${px}px;height:\${px}px;
    background-image:url('\${atlasUrl}');
    background-size:\${sheetW * scale}px \${cell.height * scale}px;
    background-position:-\${cell.x * scale}px 0;
    transform:rotate(\${angle}deg);
  "></span>\`;
}

const [svgImage, bikeImage] = await Promise.all([
  load(${JSON.stringify(atlasUrl)}),
  load("./fleet-bike-north.png"),
]);
const canvas = document.createElement("canvas");
canvas.width = svgImage.naturalWidth || svgImage.width;
canvas.height = svgImage.naturalHeight || svgImage.height;
const ctx = canvas.getContext("2d");
ctx.drawImage(svgImage, 0, 0, canvas.width, canvas.height);
for (const [name, cell] of Object.entries(mapping)) {
  if (!name.startsWith("pin-bike-")) continue;
  ctx.save();
  ctx.globalAlpha = name.endsWith("-stale") ? 0.5 : 1;
  ctx.drawImage(
    bikeImage,
    cell.x + (cell.width - stampPx) / 2,
    cell.y + (cell.height - stampPx) / 2,
    stampPx,
    stampPx,
  );
  ctx.restore();
}
const composed = canvas.toDataURL("image/png");
const s = (name, px, angle) => sprite(composed, name, px, angle);

document.getElementById("root").innerHTML = \`
<h2>Ships at these sizes (48 / 36 / 28 px)</h2>
<div class="row">
  \${[48, 36, 28].map((px) => tones.map((t) => s(\`pin-bike-\${t}\`, px)).join("")).join('<span style="width:14px"></span>')}
</div>

<h2>Car sprites (48 / 36 / 28 px) — van uses these cells</h2>
<div class="row">
  \${[48, 36, 28].map((px) => tones.map((t) => s(\`pin-car-\${t}\`, px)).join("")).join('<span style="width:14px"></span>')}
</div>

<h2>Rotation — 0 / 90 / 180 / 270 (plus 45s)</h2>
<div class="row">
  \${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => s("pin-bike-success", 40, a)).join("")}
</div>
<div class="row" style="margin-top:8px">
  \${[0, 90, 180, 270].map((a) => s("pin-bike-danger", 48, a)).join("")}
</div>

<h2>Stale variants (36px)</h2>
<div class="row">\${tones.map((t) => s(\`pin-bike-\${t}-stale\`, 36)).join("")}</div>
<div class="row" style="margin-top:8px">\${tones.map((t) => s(\`pin-car-\${t}-stale\`, 36)).join("")}</div>

<h2>Over a dark basemap / satellite</h2>
<div class="row">
  <div class="dark">\${tones.map((t) => s(\`pin-bike-\${t}\`, 36)).join("")}\${tones.map((t) => s(\`pin-car-\${t}\`, 36)).join("")}</div>
  <div class="sat">\${tones.map((t) => s(\`pin-bike-\${t}\`, 36)).join("")}\${tones.map((t) => s(\`pin-car-\${t}\`, 36)).join("")}</div>
</div>

<h2>Selection ring behind the marker (40px)</h2>
<div class="row">
  <span style="position:relative;display:inline-block;width:48px;height:48px">
    <span style="position:absolute;inset:0">\${s("ring", 48)}</span>
    <span style="position:absolute;inset:4px">\${s("pin-bike-success", 40)}</span>
  </span>
</div>

<h2>Density check — 60 markers at 30px</h2>
<div class="row" style="gap:2px;max-width:520px">
  \${Array.from({ length: 60 }, (_, i) => s(\`pin-\${i % 2 === 0 ? "bike" : "car"}-\${tones[i % tones.length]}\`, 30, (i * 37) % 360)).join("")}
</div>

<h2>Raw composed atlas sheet</h2>
<img class="atlas" src="\${composed}" alt="atlas">
\`;
</script>
`;

await mkdir(outDir, { recursive: true });
await copyFile(bikePng, join(outDir, "fleet-bike-north.png"));
await writeFile(join(outDir, "index.html"), html, "utf8");
console.log(`wrote ${join(outDir, "index.html")}`);
