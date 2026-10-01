/**
 * Render the release notes in `docs/releases/**` to PDF with the same print CSS
 * the browser uses, so the HTML a reviewer reads and the PDF a client forwards
 * cannot drift.
 *
 * Usage:
 *   node scripts/release-pdf.mjs docs/releases/2026-09-30-bulk-delete-vehicle/*.html
 *
 * Each HTML file is printed next to itself with a `.pdf` extension and the A4
 * `@page` rule it already declares (`preferCSSPageSize`), because the release
 * templates carry their own page margins and a Playwright margin would sit on
 * top of them.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const inputs = process.argv.slice(2).filter((arg) => arg.toLowerCase().endsWith(".html"));

if (inputs.length === 0) {
  console.error("No .html input. Example: node scripts/release-pdf.mjs docs/releases/<pack>/*.html");
  process.exit(1);
}

const targets = [];
for (const input of inputs) {
  const absolute = path.resolve(input);
  if (!existsSync(absolute)) {
    console.error(`Missing input: ${absolute}`);
    process.exit(1);
  }
  targets.push({ htmlPath: absolute, pdfPath: absolute.replace(/\.html$/i, ".pdf") });
}

const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  for (const { htmlPath, pdfPath } of targets) {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });

    // The templates are self-contained (inline CSS, no webfonts), so there is
    // nothing to await beyond layout settling for the page-break rules.
    await page.waitForTimeout(150);

    await page.pdf({
      path: pdfPath,
      printBackground: true,
      preferCSSPageSize: true,
    });

    await page.close();

    const size = (await readFile(pdfPath)).byteLength;
    console.log(`${path.relative(process.cwd(), pdfPath)}  ${(size / 1024).toFixed(1)} KB`);
  }
} finally {
  await browser.close();
}
