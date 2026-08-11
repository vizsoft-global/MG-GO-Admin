/**
 * Names the element that scrolls on a route, so a "fits one viewport" failure can be
 * traced to a specific container instead of a screenshot impression.
 *
 *   node scripts/qa-overflow.mjs /requests/overview /requests/settings/screenshot
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const STATE = ".qa/session.json";
const routes = process.argv.slice(2);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  storageState: existsSync(STATE) ? STATE : undefined,
});
const page = await context.newPage();
page.setDefaultTimeout(120_000);
page.setDefaultNavigationTimeout(120_000);

for (const route of routes) {
  await page.goto(`${BASE}/en${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  // React Query can settle after networkidle; measuring too early undercounts rows.
  await page.waitForTimeout(4000);
  const found = await page.evaluate(() => {
    const describe = (el) => {
      const cls = (el.className || "").toString().split(/\s+/).slice(0, 4).join(".");
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls ? `.${cls}` : ""}` +
        `${el.dataset.slot ? `[data-slot=${el.dataset.slot}]` : ""}`;
    };
    return [...document.querySelectorAll("*")]
      .filter((el) => {
        const style = getComputedStyle(el);
        return /auto|scroll/.test(style.overflowY) && el.scrollHeight - el.clientHeight > 8;
      })
      .map((el) => ({
        el: describe(el),
        over: el.scrollHeight - el.clientHeight,
        client: el.clientHeight,
        rows: el.querySelectorAll("tbody tr").length,
      }));
  });
  console.log(`\n${route}`);
  for (const f of found) console.log(`  +${f.over}px over  client=${f.client}  rows=${f.rows}  ${f.el}`);
  if (found.length === 0) console.log("  nothing scrolls");
}

await browser.close();
