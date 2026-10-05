/**
 * EmployeeDesk V2 / OperationsHub / eSign V2 / Settings — visual evidence pass.
 *
 * Reuses one logged-in session across every route and captures each screen at
 * the 14" target viewport (1366x768) in both locales, recording the same
 * measurements the rulebook's pre-ship checklist asks about: whether the page
 * scrolls at all, whether a raw enum key leaked into a select trigger, and how
 * many nested scrollers a screen carries.
 *
 *   node scripts/qa-v2-verify.mjs --out .qa/v2          # EN + AR
 *   node scripts/qa-v2-verify.mjs --out .qa/v2 --locale ar
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const STATE = ".qa/session.json";
const VIEWPORT = { width: 1366, height: 768 };

const ROUTES = [
  // OperationsHub — every operational settings group under one roof.
  "/operations",
  // Settings — the 7 admin items plus the separate System group.
  "/settings",
  "/settings/app",
  "/settings/maintenance",
  "/settings/languages",
  "/settings/data-cleanup",
  "/settings/storage",
  "/settings/vehicle-uses",
  // EmployeeDesk V2 — the additive tree.
  "/employeedesk",
  "/employeedesk/all",
  "/employeedesk/incoming",
  "/employeedesk/outgoing",
  "/employeedesk/reports",
  "/employeedesk/settings",
  // EmployeeDesk V2 — eSign.
  "/employeedesk/esign",
  "/employeedesk/esign/send",
  "/employeedesk/esign/bulk",
  "/employeedesk/esign/waiting",
  "/employeedesk/esign/templates",
  "/employeedesk/esign/templates/new",
  "/employeedesk/esign/signing",
  // EmployeeDesk V2 — Visits.
  "/employeedesk/visits",
  "/employeedesk/visits/all",
  "/employeedesk/visits/calendar",
  "/employeedesk/visits/reception",
  "/employeedesk/visits/slots",
  "/employeedesk/visits/departments",
  "/employeedesk/visits/branches",
  "/employeedesk/visits/reports",
  // V1 parity — the same screens entered through the old door must still work.
  "/requests",
  "/requests/overview",
  "/requests/esign/drafts",
  "/requests/esign",
  "/requests/esign/sent",
  "/requests/esign/batches",
  "/requests/esign/drafts",
  "/requests/esign/waiting",
  "/requests/esign/categories",
  "/requests/settings/reports",
];

function readEnvLocal() {
  const file = path.resolve(".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const args = process.argv.slice(2);
let outDir = ".qa/v2";
let locales = ["en", "ar"];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--out") {
    outDir = args[i + 1];
    i += 1;
  } else if (args[i] === "--locale") {
    locales = [args[i + 1]];
    i += 1;
  }
}

const env = readEnvLocal();
const EMAIL = process.env.QA_EMAIL ?? env.QA_EMAIL ?? env.ADMIN_EMAIL;
const PASSWORD = process.env.QA_PASSWORD ?? env.QA_PASSWORD ?? env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("QA_EMAIL / QA_PASSWORD missing");

const slug = (locale, route) =>
  `${locale}-${route.replace(/^\//, "").replace(/\//g, "-").replace(/[^a-z0-9-]/gi, "_") || "home"}`;

await mkdir(outDir, { recursive: true });
await mkdir(".qa", { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: VIEWPORT,
  storageState: existsSync(STATE) ? STATE : undefined,
});

async function login() {
  const page = await context.newPage();
  page.setDefaultTimeout(180_000);
  await page.goto(`${BASE}/en/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 90_000 });
  await context.storageState({ path: STATE });
  await page.close();
}

const probe = await context.newPage();
await probe.goto(`${BASE}/en/login`, { waitUntil: "domcontentloaded" });
await probe.waitForTimeout(1_200);
const needsLogin = probe.url().includes("/login");
await probe.close();
if (needsLogin) await login();

const results = [];
const consoleErrors = [];

for (const locale of locales) {
  const page = await context.newPage();
  page.setDefaultTimeout(180_000);
  page.setDefaultNavigationTimeout(180_000);
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ locale, url: page.url(), text: msg.text().slice(0, 300) });
    }
  });

  for (const route of ROUTES) {
    const file = path.join(outDir, `${slug(locale, route)}.png`);
    try {
      await page.goto(`${BASE}/${locale}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 180_000,
      });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(700);

      const metrics = await page.evaluate(() => {
        const main = document.querySelector("main");
        const scrollers = [...document.querySelectorAll("*")].filter((el) => {
          const style = getComputedStyle(el);
          return (
            /auto|scroll/.test(style.overflowY) &&
            el.scrollHeight - el.clientHeight > 8 &&
            el.dataset.slot !== "sidebar-content"
          );
        });
        const rawKeys = [...document.querySelectorAll('[data-slot="select-trigger"]')]
          .map((n) => n.innerText.trim())
          .filter((t) => /^[a-z0-9]+(_[a-z0-9]+)*$/.test(t));
        // A literal message key painted on screen is the failure mode a build,
        // a type check and a unit test all pass straight through.
        const rawI18n = [...document.querySelectorAll("h1,h2,h3,label,span,p,button")]
          .map((n) => n.childElementCount === 0 ? (n.textContent ?? "").trim() : "")
          .filter((t) => /^(pages|errors|common|nav)\.[A-Za-z0-9_.]+$/.test(t));
        return {
          title: document.querySelector("h1")?.textContent?.trim() ?? null,
          dir: document.documentElement.dir || "ltr",
          pageScroll: main ? main.scrollHeight - main.clientHeight : 0,
          sideScroll: main ? main.scrollWidth - main.clientWidth : 0,
          innerScrollers: scrollers.length,
          rawValueTriggers: [...new Set(rawKeys)],
          rawI18n: [...new Set(rawI18n)].slice(0, 8),
        };
      });

      await page.screenshot({ path: file });
      results.push({ locale, route, file, ...metrics });
      const flags = [
        metrics.pageScroll > 8 ? `scroll=${metrics.pageScroll}px` : "",
        metrics.sideScroll > 8 ? `SIDE=${metrics.sideScroll}px` : "",
        metrics.innerScrollers > 2 ? `inner=${metrics.innerScrollers}` : "",
        metrics.rawValueTriggers.length ? `RAW_SELECT=${metrics.rawValueTriggers.join("|")}` : "",
        metrics.rawI18n.length ? `RAW_I18N=${metrics.rawI18n.join("|")}` : "",
      ].filter(Boolean);
      console.log(
        `ok   ${locale} ${route}  dir=${metrics.dir} title=${JSON.stringify(metrics.title)}` +
          (flags.length ? `  ${flags.join(" ")}` : ""),
      );
    } catch (error) {
      results.push({ locale, route, error: String(error).slice(0, 200) });
      console.log(`FAIL ${locale} ${route}  ${String(error).slice(0, 140)}`);
    }
  }
  await page.close();
}

await writeFile(
  path.join(outDir, "report.json"),
  JSON.stringify({ base: BASE, viewport: VIEWPORT, results, consoleErrors }, null, 2),
);

const problems = results.filter(
  (r) =>
    r.error ||
    (r.pageScroll ?? 0) > 8 ||
    (r.sideScroll ?? 0) > 8 ||
    (r.rawValueTriggers?.length ?? 0) > 0 ||
    (r.rawI18n?.length ?? 0) > 0,
);
console.log(
  `\n${results.length} captures -> ${outDir}  (${problems.length} flagged, ${consoleErrors.length} console errors)`,
);
await browser.close();
if (problems.length) {
  for (const p of problems) console.log(`FLAG ${p.locale} ${p.route}`, JSON.stringify(p).slice(0, 240));
}
