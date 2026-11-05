/**
 * The 1366x768 pass, one route at a time so a slow compile cannot stall the whole
 * run: prints the DOM cells, rows, overflow and console errors per route, twice
 * (the first hit pays Turbopack's compile, the second is the real paint).
 *
 *   node scripts/qa-routes.mjs /payroll /payroll/hr ...
 */
import { chromium } from "playwright";
import { existsSync, appendFileSync } from "node:fs";

const routes = process.argv.slice(2);
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const STATE = ".qa/session.json";
const OUT = "qa-routes.log";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  storageState: existsSync(STATE) ? STATE : undefined,
});
const page = await context.newPage();
page.setDefaultTimeout(90_000);
page.setDefaultNavigationTimeout(90_000);
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 160));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

for (const route of routes) {
  for (const pass of [1, 2]) {
    errors.length = 0;
    const started = Date.now();
    let ok = true;
    try {
      await page.goto(`${BASE}/en${route}`, { waitUntil: "domcontentloaded" });
      ok = await page
        .waitForFunction(() => document.querySelectorAll("main tbody tr").length > 0, null, { timeout: 60_000 })
        .then(() => true)
        .catch(() => false);
    } catch (error) {
      ok = false;
      errors.push(String(error).slice(0, 160));
    }
    const paintMs = Date.now() - started;
    await page.waitForTimeout(1000);
    const stats = await page
      .evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        return {
          tds: main.querySelectorAll("td").length,
          trs: main.querySelectorAll("tbody tr").length,
          nodes: main.querySelectorAll("*").length,
          scrollWidth: document.body.scrollWidth,
          viewport: window.innerWidth,
          heading: (document.querySelector("h1")?.textContent ?? "").trim().slice(0, 32),
        };
      })
      .catch(() => ({ tds: -1, trs: -1, nodes: -1, scrollWidth: -1, viewport: 1366, heading: "" }));
    const line = `pass${pass} ${route.padEnd(34)} rows=${String(stats.trs).padStart(4)} cells=${String(
      stats.tds,
    ).padStart(6)} nodes=${String(stats.nodes).padStart(6)} width=${stats.scrollWidth}/${stats.viewport} ${
      stats.scrollWidth > stats.viewport ? "OVERFLOW" : "ok"
    } paint=${paintMs}ms firstRow=${ok} errors=${errors.length} h1="${stats.heading}"`;
    console.log(line);
    appendFileSync(OUT, `${line}\n`);
  }
}
await browser.close();
