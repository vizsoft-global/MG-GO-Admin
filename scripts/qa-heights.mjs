/**
 * Dumps the height of every top-level block inside <main>, so an over-tall page can
 * be cut where the pixels actually are.
 *
 *   node scripts/qa-heights.mjs /requests/overview
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const STATE = ".qa/session.json";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1366, height: 768 },
  storageState: existsSync(STATE) ? STATE : undefined,
});
const page = await context.newPage();
page.setDefaultTimeout(120_000);
page.setDefaultNavigationTimeout(120_000);

for (const route of process.argv.slice(2)) {
  await page.goto(`${BASE}/en${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  // React Query can settle after networkidle; measuring too early undercounts rows.
  await page.waitForTimeout(4000);
  const dump = await page.evaluate(() => {
    const label = (el) =>
      `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(/\s+/).slice(0, 3).join(".")}`;
    const mains = [...document.querySelectorAll("main")];
    const main = mains.find((m) => m.scrollHeight - m.clientHeight > 8) ?? mains.at(-1);
    const walk = (el, depth) => {
      const out = [];
      for (const child of el.children) {
        out.push({
          depth,
          label: label(child),
          h: Math.round(child.getBoundingClientRect().height),
          text: (child.textContent || "").trim().slice(0, 40).replace(/\s+/g, " "),
        });
        if (depth < 2) out.push(...walk(child, depth + 1));
      }
      return out;
    };
    return {
      main: main ? main.scrollHeight : 0,
      client: main ? main.clientHeight : 0,
      blocks: main ? walk(main, 0) : [],
    };
  });
  console.log(`\n${route}  main ${dump.main} / ${dump.client}  (+${dump.main - dump.client})`);
  for (const b of dump.blocks) {
    console.log(`${"  ".repeat(b.depth + 1)}${String(b.h).padStart(4)}px  ${b.label}  ${b.text}`);
  }
}

await browser.close();
