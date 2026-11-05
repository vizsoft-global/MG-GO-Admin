/**
 * One route, one number: how many table cells does the page put in the DOM, and
 * how long until its first data row appears?
 *
 *   node scripts/qa-one-page.mjs /payroll/hr
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const route = process.argv[2] ?? "/payroll/hr";
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const STATE = ".qa/session.json";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  storageState: existsSync(STATE) ? STATE : undefined,
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);
page.setDefaultNavigationTimeout(60_000);
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 160));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

const started = Date.now();
await page.goto(`${BASE}/en${route}`, { waitUntil: "domcontentloaded" });
const firstRow = await page
  .waitForFunction(() => document.querySelectorAll("main tbody tr").length > 0, null, { timeout: 45_000 })
  .then(() => true)
  .catch(() => false);
const paintMs = Date.now() - started;
await page.waitForTimeout(1200);
const stats = await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  return {
    tds: main.querySelectorAll("td").length,
    trs: main.querySelectorAll("tbody tr").length,
    nodes: main.querySelectorAll("*").length,
    scrollWidth: document.body.scrollWidth,
    viewport: window.innerWidth,
    heading: (document.querySelector("h1")?.textContent ?? "").trim().slice(0, 40),
    url: location.pathname + location.search,
  };
});
console.log(
  JSON.stringify({ route, firstRow, paintMs, ...stats, errors: errors.length, firstError: errors[0] ?? null }, null, 0),
);
await browser.close();
