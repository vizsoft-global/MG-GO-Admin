/**
 * Prints the box of every element matching a selector on a route, for tracking down a
 * container that is wider than its viewport.
 *
 *   node scripts/qa-probe.mjs /requests/settings/screenshot "table, [data-slot=card]"
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const [route, selector] = process.argv.slice(2);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  storageState: existsSync(".qa/session.json") ? ".qa/session.json" : undefined,
});
const page = await context.newPage();
page.setDefaultTimeout(120_000);
await page.goto(`${BASE}/en${route}`, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(4000);

const rows = await page.evaluate((sel) => {
  return [...document.querySelectorAll(sel)].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().slice(0, 60),
      left: Math.round(r.left),
      right: Math.round(r.right),
      w: Math.round(r.width),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
    };
  });
}, selector);

for (const r of rows) {
  console.log(
    `${String(r.left).padStart(5)}→${String(r.right).padStart(5)}  w=${String(r.w).padStart(5)}  scrollW=${String(r.scrollW).padStart(5)}  ${r.tag}  ${r.cls}`,
  );
}

await browser.close();
