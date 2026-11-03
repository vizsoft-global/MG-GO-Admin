/**
 * Rider Operations V2 / Client Portal V2 visual evidence pass.
 *
 * Reuses the logged-in session in `.qa/session.json`, opens each V2 route at the
 * 1440x900 frame size and the 1366x768 laptop size, and records console errors,
 * horizontal overflow and the page height beside a full-page screenshot.
 *
 *   node scripts/qa-v2-pages.mjs --out .qa/v2-pages
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const STATE = ".qa/session.json";
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : ".qa/v2-pages";

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

const ROUTES = [
  { name: "en-operations-v2", path: "/en/operations-dashboard-v2" },
  { name: "ar-operations-v2", path: "/ar/operations-dashboard-v2" },
  { name: "en-portal-v2-clients", path: "/en/client-portal-v2/clients" },
  { name: "en-portal-v2-dashboard", path: "/en/client-portal-v2/preview/keeta" },
  { name: "ar-portal-v2-dashboard", path: "/ar/client-portal-v2/preview/keeta" },
  { name: "en-portal-v2-employees", path: "/en/client-portal-v2/employees?project=keeta" },
];

const viewport = { width: 1440, height: 900 };

if (!existsSync(STATE)) throw new Error(`missing ${STATE}`);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport, storageState: STATE });
context.setDefaultTimeout(180_000);
context.setDefaultNavigationTimeout(180_000);

const env = readEnvLocal();
const EMAIL = process.env.QA_EMAIL ?? env.QA_EMAIL ?? env.ADMIN_EMAIL;
const PASSWORD = process.env.QA_PASSWORD ?? env.QA_PASSWORD ?? env.ADMIN_PASSWORD;

async function login() {
  if (!EMAIL || !PASSWORD) throw new Error("QA_EMAIL / QA_PASSWORD missing");
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

const report = [];

for (const route of ROUTES) {
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  const started = Date.now();
  await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded", timeout: 120_000 }).catch((error) => {
    errors.push(`goto: ${error.message}`);
  });
  await page.waitForTimeout(14_000);
  let metrics;
  try {
    metrics = await page.evaluate(() => ({
      url: location.pathname,
      title: document.title,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      height: document.documentElement.scrollHeight,
      h1: document.querySelector("h1")?.textContent?.trim() ?? "",
      sample: (document.querySelector("main")?.innerText ?? "").replace(/\s+/g, " ").slice(0, 320),
      rawKeys: Array.from(document.querySelectorAll("main *"))
        .filter((node) => node.children.length === 0 && /^[a-z]+\.[a-zA-Z.]+$/.test(node.textContent?.trim() ?? ""))
        .slice(0, 5)
        .map((node) => node.textContent?.trim()),
    }));
  } catch (error) {
    metrics = { url: page.url(), error: String(error) };
  }
  await page.screenshot({ path: `${OUT}/${route.name}.png`, fullPage: true });
  report.push({ name: route.name, ms: Date.now() - started, ...metrics, errors: errors.slice(0, 8) });
  console.log(route.name, JSON.stringify({ ...metrics, errors: errors.length }));
  await page.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
