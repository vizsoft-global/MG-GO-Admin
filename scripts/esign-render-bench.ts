/**
 * Local Chromium bench + compose-compat. Writes PDFs + RENDER-BENCH.json.
 * Usage: npx tsx scripts/esign-render-bench.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runEsignRenderBench } from "../src/features/esign/render/esign-render-bench";

async function main() {
  const outDir = path.join(process.cwd(), "docs/releases/2026-09-23-esign-sender");
  mkdirSync(outDir, { recursive: true });
  const { report, pdfs } = await runEsignRenderBench("local-chrome");
  writeFileSync(path.join(outDir, "en-1.pdf"), pdfs.en);
  writeFileSync(path.join(outDir, "ar-1.pdf"), pdfs.ar);
  writeFileSync(path.join(outDir, "ar-2.pdf"), pdfs.arLong);
  writeFileSync(path.join(outDir, "RENDER-BENCH.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
