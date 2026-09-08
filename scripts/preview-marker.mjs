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
  FLEET_BIKE_ART_PX,
  FLEET_BIKE_CRATE,
  FLEET_BIKE_CRATE_PLATE,
  FLEET_BIKE_LOGO_CRATE_FIT,
  FLEET_BIKE_STAMP_PX,
  FLEET_PIN_SIZE,
  FLEET_TONE_FILL,
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
const crateLogoPng = fileURLToPath(
  new URL("../src/features/live-tracking-v2/assets/fleet-crate-logo.png", import.meta.url),
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
const pinSize = ${FLEET_PIN_SIZE};
const toneFill = ${JSON.stringify(FLEET_TONE_FILL)};
const crateArt = ${JSON.stringify({
  art: FLEET_BIKE_ART_PX,
  crate: FLEET_BIKE_CRATE,
  plate: FLEET_BIKE_CRATE_PLATE,
  fit: FLEET_BIKE_LOGO_CRATE_FIT,
})};
const tones = ["success", "primary", "warning", "danger", "neutral"];

function logoBoxFor(cell, logoW, logoH) {
  const scale = stampPx / crateArt.art;
  const originX = cell.x + (cell.width - stampPx) / 2;
  const originY = cell.y + (cell.height - stampPx) / 2;
  const crateCx = originX + crateArt.plate.cx * scale;
  const crateCy = originY + crateArt.plate.cy * scale;
  const maxW = crateArt.crate.width * scale * crateArt.fit;
  const maxH = crateArt.crate.height * scale * crateArt.fit;
  const aspect = logoW / Math.max(logoH, 1);
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { x: crateCx - w / 2, y: crateCy - h / 2, w, h };
}

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

const [svgImage, bikeImage, logoImage] = await Promise.all([
  load(${JSON.stringify(atlasUrl)}),
  load("./fleet-bike-north.png"),
  load("./fleet-crate-logo.png"),
]);

function stampBikes(ctx, withLogo) {
  const scratch = document.createElement("canvas");
  scratch.width = 96;
  scratch.height = 96;
  const sctx = scratch.getContext("2d", { willReadFrequently: true });
  for (const [name, cell] of Object.entries(mapping)) {
    if (!name.startsWith("pin-bike-")) continue;
    const tone = tones.find((t) => name.includes("-" + t)) ?? "neutral";
    sctx.clearRect(0, 0, 96, 96);
    sctx.globalAlpha = name.endsWith("-stale") ? 0.5 : 1;
    sctx.drawImage(bikeImage, (96 - stampPx) / 2, (96 - stampPx) / 2, stampPx, stampPx);
    sctx.globalAlpha = 1;
    const hex = toneFill[tone];
    const tr = parseInt(hex.slice(1, 3), 16);
    const tg = parseInt(hex.slice(3, 5), 16);
    const tb = parseInt(hex.slice(5, 7), 16);
    const image = sctx.getImageData(0, 0, 96, 96);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 8) continue;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      const t = 0.28 + lum * 0.72;
      data[i] = tr * t;
      data[i + 1] = tg * t;
      data[i + 2] = tb * t;
    }
    sctx.putImageData(image, 0, 0);
    ctx.drawImage(scratch, cell.x, cell.y);
    if (withLogo) {
      ctx.save();
      ctx.globalAlpha = name.endsWith("-stale") ? 0.5 : 1;
      const box = logoBoxFor(cell, logoImage.naturalWidth || logoImage.width, logoImage.naturalHeight || logoImage.height);
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, 2);
      ctx.clip();
      ctx.drawImage(logoImage, box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }
}

function compose(withLogo) {
  const canvas = document.createElement("canvas");
  canvas.width = svgImage.naturalWidth || svgImage.width;
  canvas.height = svgImage.naturalHeight || svgImage.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(svgImage, 0, 0, canvas.width, canvas.height);
  stampBikes(ctx, withLogo);
  return canvas.toDataURL("image/png");
}

const composed = compose(true);
const composedBare = compose(false);
const s = (name, px, angle) => sprite(composed, name, px, angle);
const bare = (name, px, angle) => sprite(composedBare, name, px, angle);

document.getElementById("root").innerHTML = \`
<h2>Ships at \${pinSize}px (plus 36 / 28 for zoom-out)</h2>
<div class="row">
  \${[pinSize, 36, 28].map((px) => tones.map((t) => s(\`pin-bike-\${t}\`, px)).join("")).join('<span style="width:14px"></span>')}
</div>

<h2>No logo — fail-open (same sizes)</h2>
<div class="row">
  \${[pinSize, 36, 28].map((px) => tones.map((t) => bare(\`pin-bike-\${t}\`, px)).join("")).join('<span style="width:14px"></span>')}
</div>

<h2>Car sprites (\${pinSize} / 36 / 28 px) — van uses these cells, no logo</h2>
<div class="row">
  \${[pinSize, 36, 28].map((px) => tones.map((t) => s(\`pin-car-\${t}\`, px)).join("")).join('<span style="width:14px"></span>')}
</div>

<h2>Rotation — box stays on the rear crate</h2>
<div class="row">
  \${[0, 90, 180, 270].map((a) => s("pin-bike-success", pinSize, a)).join("")}
</div>
<div class="row" style="margin-top:8px">
  \${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => s("pin-bike-danger", 40, a)).join("")}
</div>

<h2>Stale variants (36px)</h2>
<div class="row">\${tones.map((t) => s(\`pin-bike-\${t}-stale\`, 36)).join("")}</div>
<div class="row" style="margin-top:8px">\${tones.map((t) => s(\`pin-car-\${t}-stale\`, 36)).join("")}</div>

<h2>Over a dark basemap / satellite</h2>
<div class="row">
  <div class="dark">\${tones.map((t) => s(\`pin-bike-\${t}\`, pinSize)).join("")}\${tones.map((t) => s(\`pin-car-\${t}\`, pinSize)).join("")}</div>
  <div class="sat">\${tones.map((t) => s(\`pin-bike-\${t}\`, pinSize)).join("")}\${tones.map((t) => s(\`pin-car-\${t}\`, pinSize)).join("")}</div>
</div>

<h2>Selected is 1.2x — no ring</h2>
<div class="row">
  \${s("pin-bike-success", pinSize)}
  \${s("pin-bike-success", Math.round(pinSize * 1.2))}
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
await copyFile(crateLogoPng, join(outDir, "fleet-crate-logo.png"));
await writeFile(join(outDir, "index.html"), html, "utf8");
console.log(`wrote ${join(outDir, "index.html")}`);
