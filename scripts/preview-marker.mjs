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
  FLEET_BIKE_LOGO_OFFSET,
  FLEET_BIKE_LOGO_PAD_PX,
  FLEET_BIKE_STAMP_PX,
  FLEET_PIN_SIZE,
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
const logoPad = ${FLEET_BIKE_LOGO_PAD_PX};
const logoOffset = ${FLEET_BIKE_LOGO_OFFSET};
const pinSize = ${FLEET_PIN_SIZE};
const tones = ["success", "primary", "warning", "danger", "neutral"];
const sampleLogo =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#059669"/><text x="16" y="22" text-anchor="middle" font-size="16" font-family="ui-sans-serif,system-ui" font-weight="700" fill="#fff">M</text></svg>',
  );

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
  load(sampleLogo),
]);

function stampBikes(ctx, withLogo) {
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
    if (withLogo) {
      const cx = cell.x + cell.width / 2;
      const cy = cell.y + cell.height / 2 + stampPx * logoOffset;
      const x = cx - logoPad / 2;
      const y = cy - logoPad / 2;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(x, y, logoPad, logoPad, 3);
      ctx.fill();
      ctx.drawImage(logoImage, x + 2, y + 2, logoPad - 4, logoPad - 4);
    }
    ctx.restore();
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

<h2>Selection ring behind the marker</h2>
<div class="row">
  <span style="position:relative;display:inline-block;width:72px;height:72px">
    <span style="position:absolute;inset:0">\${s("ring", 67)}</span>
    <span style="position:absolute;inset:5px">\${s("pin-bike-success", pinSize)}</span>
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
