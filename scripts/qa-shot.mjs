/**
 * Bulk QA screenshots for the Figma pin-to-pin pass.
 *
 * Reuses one logged-in session across every route so a whole batch of screens is
 * captured in a single browser launch, at the 1366x768 target viewport.
 *
 *   node scripts/qa-shot.mjs --out .qa/rcm /requests /requests/settings/workflows
 *   node scripts/qa-shot.mjs --out .qa/vb --all-vb
 *
 * Uses the locally installed Chrome (channel: chrome) so no browser download is needed.
 */
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.QA_EMAIL ?? "admin@vizsoft.in";
const PASSWORD = process.env.QA_PASSWORD;
const STATE = ".qa/session.json";

const VIEWPORT = { width: 1366, height: 768 };

const GROUPS = {
  "--all-rcm": [
    "/requests",
    "/requests/overview",
    "/requests/settings",
    "/requests/settings/workflows",
    "/requests/settings/categories",
    "/requests/settings/types",
    "/requests/settings/assets",
    "/requests/settings/departments",
    "/requests/settings/roles",
    "/requests/settings/screenshot",
    "/requests/settings/audit",
    "/requests/settings/reports",
    "/requests/import-export",
  ],
  "--all-esign": [
    "/requests/esign",
    "/requests/esign/sent",
    "/requests/esign/signatures",
    "/requests/esign/categories",
  ],
  "--all-vb": [
    "/visit-bookings",
    "/visit-bookings/all",
    "/visit-bookings/calendar",
    "/visit-bookings/reception",
    "/visit-bookings/slots",
    "/visit-bookings/departments",
    "/visit-bookings/branches",
    "/visit-bookings/reports",
  ],
};

const args = process.argv.slice(2);
let outDir = ".qa/shots";
let warmOnly = false;
const routes = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--out") {
    outDir = args[i + 1];
    i += 1;
  } else if (arg === "--warm") {
    warmOnly = true;
  } else if (arg === "--all") {
    routes.push(...GROUPS["--all-rcm"], ...GROUPS["--all-esign"], ...GROUPS["--all-vb"]);
  } else if (GROUPS[arg]) {
    routes.push(...GROUPS[arg]);
  } else {
    routes.push(arg);
  }
}
if (routes.length === 0) routes.push(...GROUPS["--all-rcm"]);

const slug = (route) =>
  route.replace(/^\//, "").replace(/\//g, "-").replace(/[^a-z0-9-]/gi, "_") || "home";

async function login(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  page.setDefaultNavigationTimeout(120_000);
  await page.goto(`${BASE}/en/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60_000 });
  await context.storageState({ path: STATE });
  await page.close();
}

const results = [];

await mkdir(outDir, { recursive: true });
await mkdir(".qa", { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: VIEWPORT,
  storageState: existsSync(STATE) ? STATE : undefined,
});

// Probe with the cheapest authenticated route: the login page bounces to the
// dashboard when a session cookie is present, and it compiles fast even while
// the dev server is busy with other routes.
const probe = await context.newPage();
probe.setDefaultTimeout(180_000);
probe.setDefaultNavigationTimeout(180_000);
await probe.goto(`${BASE}/en/login`, { waitUntil: "domcontentloaded" });
await probe.waitForTimeout(1_500);
const needsLogin = probe.url().includes("/login");
await probe.close();
if (needsLogin) {
  if (!PASSWORD) throw new Error("QA_PASSWORD is required for the first login");
  await login(context);
}

// Warm mode: compile every route server-side, a few at a time. Turbopack pays the
// first-compile cost once here instead of once per agent per screen.
if (warmOnly) {
  const CONCURRENCY = 4;
  const queue = [...routes];
  const started = Date.now();
  const worker = async () => {
    while (queue.length > 0) {
      const route = queue.shift();
      const t0 = Date.now();
      try {
        const res = await context.request.get(`${BASE}/en${route}`, { timeout: 300_000 });
        console.log(`warm ${res.status()}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${route}`);
      } catch (error) {
        console.log(`warm FAIL ${route}  ${String(error).slice(0, 120)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\nwarmed ${routes.length} routes in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  await browser.close();
  process.exit(0);
}

const page = await context.newPage();
page.setDefaultTimeout(180_000);
page.setDefaultNavigationTimeout(180_000);
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push({ url: page.url(), text: msg.text().slice(0, 300) });
});

for (const route of routes) {
  const file = path.join(outDir, `${slug(route)}.png`);
  try {
    await page.goto(`${BASE}/en${route}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const overflow = await page.evaluate(() => {
      // The dashboard shell is h-svh overflow-hidden, so documentElement never
      // scrolls: the content scroller is <main>. Measure that, and ignore the
      // sidebar nav, which is allowed to scroll.
      const scrollers = [...document.querySelectorAll("*")].filter((el) => {
        const style = getComputedStyle(el);
        return (
          /auto|scroll/.test(style.overflowY) &&
          el.scrollHeight - el.clientHeight > 8 &&
          el.dataset.slot !== "sidebar-content"
        );
      });
      const main = document.querySelector("main");
      return {
        pageScroll: main ? main.scrollHeight - main.clientHeight : 0,
        sideScroll: main ? main.scrollWidth - main.clientWidth : 0,
        innerScrollers: scrollers.length,
        title: document.querySelector("h1")?.textContent?.trim() ?? null,
        rawValueTriggers: [...document.querySelectorAll('[data-slot="select-trigger"]')]
          .map((n) => n.innerText.trim())
          .filter((t) => /^[a-z0-9]+(_[a-z0-9]+)*$/.test(t)),
      };
    });
    await page.screenshot({ path: file });
    results.push({ route, file, ...overflow });
    console.log(
      `ok   ${route}  scroll=${overflow.pageScroll}px side=${overflow.sideScroll}px inner=${overflow.innerScrollers}` +
        (overflow.rawValueTriggers.length ? `  RAW_SELECT=${overflow.rawValueTriggers.join("|")}` : ""),
    );
  } catch (error) {
    results.push({ route, error: String(error).slice(0, 200) });
    console.log(`FAIL ${route}  ${String(error).slice(0, 120)}`);
  }
}

await writeFile(
  path.join(outDir, "report.json"),
  JSON.stringify({ base: BASE, viewport: VIEWPORT, results, consoleErrors }, null, 2),
);
console.log(`\n${results.length} routes -> ${outDir}  (console errors: ${consoleErrors.length})`);

await browser.close();
